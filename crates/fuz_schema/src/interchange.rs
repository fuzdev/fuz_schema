//! The interchange form: a schema as JSON, which is how one made in
//! TypeScript gets here.
//!
//! A node is `{"kind": …, "def": …}`, with `def` what the TypeScript
//! library's `SchemaDefs` contract says that kind holds, and left out where
//! that is `undefined`. A `lazy` holds a function there, so here its `def` is
//! a name, and the document is an envelope that defines the names:
//!
//! ```json
//! {
//!   "schema": {"kind": "lazy", "def": "$0"},
//!   "defs": {
//!     "$0": {"kind": "object", "def": {
//!       "children": {"kind": "array", "def": {"kind": "lazy", "def": "$0"}}
//!     }}
//!   }
//! }
//! ```
//!
//! The loader reads the crate's own tree and is written by hand, so every
//! refusal says what it is and where, and nothing is read as something it
//! might not be: a key the form does not have is an error, as is a `literal`
//! with no `def`, which would otherwise read as `null`, and a key written
//! twice, which would otherwise read as its last value.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::de::{self, DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};

use crate::builder::{SchemaBuilder, pointer_token};
use crate::error::{JsonError, SchemaBuildError, SchemaBuildErrorKind};
use crate::json::{Json, JsonObject, JsonSeed};
use crate::schema::{NodeId, Schema, SchemaKind, SchemaLiteral};

/// The kinds of the TypeScript library that hold a JavaScript value.
const UNSUPPORTED_KINDS: [&str; 3] = ["regex", "check", "transform"];

/// Loads the schema of the interchange document that `text` is.
pub fn load_text(text: &str) -> Result<Schema, SchemaBuildError> {
    load(&parse(text)?)
}

/// Parses an interchange document, refusing a key written twice in one
/// object.
fn parse(text: &str) -> Result<Json, SchemaBuildError> {
    let state = RefCell::new(DocumentState::default());
    let mut deserializer = serde_json::Deserializer::from_str(text);
    let document = DocumentSeed { state: &state }
        .deserialize(&mut deserializer)
        .and_then(|document| deserializer.end().map(|()| document))
        .map_err(|error| {
            SchemaBuildError::new(
                SchemaBuildErrorKind::Json(JsonError::from_serde(&error)),
                "",
            )
        })?;
    match state.into_inner().repeated {
        Some((key, path)) => Err(SchemaBuildError::new(
            SchemaBuildErrorKind::RepeatedKey { key },
            path,
        )),
        None => Ok(document),
    }
}

#[derive(Default)]
struct DocumentState {
    /// Where in the document the parse is, as a JSON Pointer.
    path: String,
    /// The first key that was written a second time, and where.
    repeated: Option<(Box<str>, String)>,
}

/// Deserializes a `Json` as `JsonSeed` does, and notes the first key an
/// object has twice.
#[derive(Clone, Copy)]
struct DocumentSeed<'a> {
    state: &'a RefCell<DocumentState>,
}

impl DocumentSeed<'_> {
    /// Adds `token` to the path, and returns the length to cut it back to.
    fn enter(self, token: &str) -> usize {
        let path = &mut self.state.borrow_mut().path;
        let len = path.len();
        path.push('/');
        path.push_str(&pointer_token(token));
        len
    }

    fn leave(self, len: usize) {
        self.state.borrow_mut().path.truncate(len);
    }
}

impl<'de> DeserializeSeed<'de> for DocumentSeed<'_> {
    type Value = Json;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Json, D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for DocumentSeed<'_> {
    type Value = Json;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a JSON value")
    }

    fn visit_unit<E: de::Error>(self) -> Result<Json, E> {
        JsonSeed.visit_unit()
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Json, E> {
        JsonSeed.visit_bool(value)
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Json, E> {
        JsonSeed.visit_u64(value)
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Json, E> {
        JsonSeed.visit_i64(value)
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Json, E> {
        JsonSeed.visit_f64(value)
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Json, E> {
        JsonSeed.visit_str(value)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Json, A::Error> {
        let mut items = Vec::new();
        loop {
            let len = self.enter(&items.len().to_string());
            let item = seq.next_element_seed(self);
            self.leave(len);
            match item? {
                Some(item) => items.push(item),
                None => return Ok(Json::Array(items.into_boxed_slice())),
            }
        }
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Json, A::Error> {
        let mut entries = Vec::new();
        let mut seen: HashSet<Box<str>> = HashSet::new();
        while let Some(key) = map.next_key::<Box<str>>()? {
            let len = self.enter(&key);
            if !seen.insert(key.clone()) {
                let mut state = self.state.borrow_mut();
                if state.repeated.is_none() {
                    state.repeated = Some((key.clone(), state.path.clone()));
                }
            }
            let value = map.next_value_seed(self);
            self.leave(len);
            entries.push((key, value?));
        }
        Ok(Json::Object(JsonObject::from_entries(entries)))
    }
}

/// Loads the schema of an interchange document.
fn load(document: &Json) -> Result<Schema, SchemaBuildError> {
    let mut loader = Loader {
        builder: SchemaBuilder::new(),
        defs: Vec::new(),
        names: HashMap::new(),
        lazies: Vec::new(),
        path: String::new(),
    };
    let envelope = loader.object(document, "an object with a `schema`")?;
    loader.only_keys(envelope, &["schema", "defs"])?;
    let defs = match envelope.get("defs") {
        Some(defs) => loader.at("defs", |loader| {
            loader.object(defs, "an object of schemas by name")
        })?,
        None => &JsonObject::default(),
    };
    loader.defs = defs.iter().map(|(name, _)| name).collect();
    loader.names = loader.defs.iter().copied().zip(0..).collect();
    let schema = loader.required(envelope, "schema", "a `schema`")?;
    let root = loader.at("schema", |loader| loader.node(schema))?;
    let mut targets = Vec::with_capacity(defs.len());
    for (name, def) in defs.iter() {
        let target = loader.at("defs", |loader| loader.at(name, |loader| loader.node(def)))?;
        targets.push(target);
    }
    let Loader {
        mut builder,
        defs,
        lazies,
        ..
    } = loader;
    let mut used = vec![false; targets.len()];
    for (lazy, def) in lazies {
        used[def] = true;
        builder.define(lazy, targets[def]);
    }
    // a definition nothing refers to is checked like the others
    for (def, _) in used.iter().enumerate().filter(|&(_, used)| !used) {
        let lazy = builder.declare_named(defs[def].into());
        builder.define(lazy, targets[def]);
    }
    builder.build(root)
}

struct Loader<'a> {
    builder: SchemaBuilder,
    /// The names the document defines.
    defs: Vec<&'a str>,
    /// The position in `defs` of each name.
    names: HashMap<&'a str, usize>,
    /// Every `lazy`, with the position in `defs` of the name it holds.
    lazies: Vec<(NodeId, usize)>,
    /// Where in the document the loader is, as a JSON Pointer.
    path: String,
}

impl<'a> Loader<'a> {
    fn error(&self, kind: SchemaBuildErrorKind) -> SchemaBuildError {
        SchemaBuildError::new(kind, self.path.as_str())
    }

    fn malformed(&self, expected: &'static str) -> SchemaBuildError {
        self.error(SchemaBuildErrorKind::Malformed { expected })
    }

    /// Runs `read` with `token` added to the path.
    fn at<T>(
        &mut self,
        token: &str,
        read: impl FnOnce(&mut Self) -> Result<T, SchemaBuildError>,
    ) -> Result<T, SchemaBuildError> {
        let len = self.path.len();
        self.path.push('/');
        self.path.push_str(&pointer_token(token));
        let result = read(self);
        self.path.truncate(len);
        result
    }

    fn object(
        &self,
        json: &'a Json,
        expected: &'static str,
    ) -> Result<&'a JsonObject, SchemaBuildError> {
        match json {
            Json::Object(object) => Ok(object),
            _ => Err(self.malformed(expected)),
        }
    }

    fn array(
        &self,
        json: &'a Json,
        expected: &'static str,
    ) -> Result<&'a [Json], SchemaBuildError> {
        match json {
            Json::Array(items) => Ok(items),
            _ => Err(self.malformed(expected)),
        }
    }

    fn required(
        &self,
        object: &'a JsonObject,
        key: &str,
        expected: &'static str,
    ) -> Result<&'a Json, SchemaBuildError> {
        object.get(key).ok_or_else(|| self.malformed(expected))
    }

    /// Refuses a key that is not one of `keys`.
    fn only_keys(&mut self, object: &JsonObject, keys: &[&str]) -> Result<(), SchemaBuildError> {
        match object.iter().find(|(key, _)| !keys.contains(key)) {
            Some((key, _)) => self.at(key, |loader| {
                Err(loader.error(SchemaBuildErrorKind::UnexpectedKey { key: key.into() }))
            }),
            None => Ok(()),
        }
    }

    /// Reads a node and adds it to the builder.
    fn node(&mut self, json: &'a Json) -> Result<NodeId, SchemaBuildError> {
        let node = self.object(json, "a schema, an object with a `kind`")?;
        self.only_keys(node, &["kind", "def"])?;
        let name = match node.get("kind") {
            Some(Json::String(name)) => &**name,
            Some(_) => return self.at("kind", |loader| Err(loader.malformed("a string"))),
            None => return Err(self.malformed("a schema, an object with a `kind`")),
        };
        if let Some(kind) = UNSUPPORTED_KINDS.into_iter().find(|&kind| kind == name) {
            return Err(self.error(SchemaBuildErrorKind::UnsupportedKind { kind }));
        }
        let Some(kind) = SchemaKind::from_name(name) else {
            return Err(self.error(SchemaBuildErrorKind::UnknownKind { kind: name.into() }));
        };
        let def = node.get("def");
        match kind {
            SchemaKind::String => self.bare(def, SchemaBuilder::string),
            SchemaKind::Number => self.bare(def, SchemaBuilder::number),
            SchemaKind::Boolean => self.bare(def, SchemaBuilder::boolean),
            SchemaKind::Bigint => self.bare(def, SchemaBuilder::bigint),
            SchemaKind::Unknown => self.bare(def, SchemaBuilder::unknown),
            SchemaKind::Integer => self.bare(def, SchemaBuilder::integer),
            SchemaKind::SafeInteger => self.bare(def, SchemaBuilder::safe_integer),
            SchemaKind::Uuid => self.bare(def, SchemaBuilder::uuid),
            SchemaKind::IsoDatetime => self.bare(def, SchemaBuilder::iso_datetime),
            SchemaKind::ToLowerCase => self.bare(def, SchemaBuilder::to_lower_case),
            SchemaKind::Literal => {
                // with no `def` the TypeScript literal is `undefined`
                let Some(def) = def else {
                    return Err(self.error(SchemaBuildErrorKind::UnsupportedLiteral));
                };
                let literal = self.at("def", |loader| loader.literal(def))?;
                Ok(self.builder.literal(literal))
            }
            SchemaKind::OneOf => {
                self.with_def(def, "a `def`, an array of literals", |loader, def| {
                    let values = loader.array(def, "an array of literals")?;
                    let literals = loader.each(values, Self::literal)?;
                    Ok(loader.builder.one_of(literals))
                })
            }
            SchemaKind::Optional | SchemaKind::Nullable => {
                self.with_def(def, "a `def` with a `schema`", |loader, def| {
                    let def = loader.object(def, "an object with a `schema`")?;
                    loader.only_keys(def, &["schema"])?;
                    let schema = loader.required(def, "schema", "an object with a `schema`")?;
                    let schema = loader.at("schema", |loader| loader.node(schema))?;
                    Ok(if kind == SchemaKind::Optional {
                        loader.builder.optional(schema)
                    } else {
                        loader.builder.nullable(schema)
                    })
                })
            }
            SchemaKind::WithDefault => self.with_def(
                def,
                "a `def` with a `schema` and a `value`",
                |loader, def| {
                    let expected = "an object with a `schema` and a `value`";
                    let def = loader.object(def, expected)?;
                    loader.only_keys(def, &["schema", "value"])?;
                    let schema = loader.required(def, "schema", expected)?;
                    let value = loader.required(def, "value", expected)?;
                    let schema = loader.at("schema", |loader| loader.node(schema))?;
                    Ok(loader.builder.with_default(schema, value.clone()))
                },
            ),
            SchemaKind::Lazy => {
                self.with_def(def, "a `def`, the name of a schema", |loader, def| {
                    let Json::String(name) = def else {
                        return Err(loader.malformed("the name of a schema"));
                    };
                    let Some(&position) = loader.names.get(&**name) else {
                        return Err(loader
                            .error(SchemaBuildErrorKind::UnresolvedLazy { name: name.clone() }));
                    };
                    let lazy = loader.builder.declare_named(name.clone());
                    loader.lazies.push((lazy, position));
                    Ok(lazy)
                })
            }
            SchemaKind::Object | SchemaKind::LooseObject | SchemaKind::StripObject => self
                .with_def(def, "a `def`, an object of entries", |loader, def| {
                    let def = loader.object(def, "an object of entries")?;
                    let mut entries = Vec::with_capacity(def.len());
                    for (key, entry) in def.iter() {
                        let entry = loader.at(key, |loader| loader.node(entry))?;
                        entries.push((key, entry));
                    }
                    Ok(match kind {
                        SchemaKind::Object => loader.builder.object(entries),
                        SchemaKind::LooseObject => loader.builder.loose_object(entries),
                        _ => loader.builder.strip_object(entries),
                    })
                }),
            SchemaKind::Record | SchemaKind::Array => {
                self.with_def(def, "a `def`, a schema", |loader, def| {
                    let schema = loader.node(def)?;
                    Ok(if kind == SchemaKind::Record {
                        loader.builder.record(schema)
                    } else {
                        loader.builder.array(schema)
                    })
                })
            }
            SchemaKind::Union | SchemaKind::Pipe => {
                self.with_def(def, "a `def`, an array of schemas", |loader, def| {
                    let schemas = loader.array(def, "an array of schemas")?;
                    let schemas = loader.each(schemas, Self::node)?;
                    Ok(if kind == SchemaKind::Union {
                        loader.builder.union(schemas)
                    } else {
                        loader.builder.pipe(schemas)
                    })
                })
            }
            SchemaKind::Variant => {
                self.with_def(def, "a `def` with a `key` and `options`", |loader, def| {
                    let expected = "an object with a `key` and `options`";
                    let def = loader.object(def, expected)?;
                    loader.only_keys(def, &["key", "options"])?;
                    let key = loader.required(def, "key", expected)?;
                    let Json::String(key) = key else {
                        return loader.at("key", |loader| Err(loader.malformed("a string")));
                    };
                    let options = loader.required(def, "options", expected)?;
                    let options = loader.at("options", |loader| {
                        let options = loader.array(options, "an array of object schemas")?;
                        loader.each(options, Self::node)
                    })?;
                    Ok(loader.builder.variant(key.clone(), options))
                })
            }
            SchemaKind::MinLength => self.bound(def, SchemaBuilder::min_length),
            SchemaKind::MaxLength => self.bound(def, SchemaBuilder::max_length),
            SchemaKind::MinValue => self.bound(def, SchemaBuilder::min_value),
            SchemaKind::MaxValue => self.bound(def, SchemaBuilder::max_value),
        }
    }

    /// A kind that holds nothing.
    fn bare(
        &mut self,
        def: Option<&Json>,
        add: fn(&mut SchemaBuilder) -> NodeId,
    ) -> Result<NodeId, SchemaBuildError> {
        if def.is_some() {
            let key = "def".into();
            return self.at("def", |loader| {
                Err(loader.error(SchemaBuildErrorKind::UnexpectedKey { key }))
            });
        }
        Ok(add(&mut self.builder))
    }

    /// A kind that holds something, read with the path at its `def`.
    fn with_def(
        &mut self,
        def: Option<&'a Json>,
        expected: &'static str,
        read: impl FnOnce(&mut Self, &'a Json) -> Result<NodeId, SchemaBuildError>,
    ) -> Result<NodeId, SchemaBuildError> {
        let def = def.ok_or_else(|| self.malformed(expected))?;
        self.at("def", |loader| read(loader, def))
    }

    fn bound(
        &mut self,
        def: Option<&'a Json>,
        add: fn(&mut SchemaBuilder, f64) -> NodeId,
    ) -> Result<NodeId, SchemaBuildError> {
        self.with_def(def, "a `def`, a number", |loader, def| match def {
            Json::Number(bound) => Ok(add(&mut loader.builder, *bound)),
            _ => Err(loader.malformed("a number")),
        })
    }

    /// Reads every item of an array, with the path at its index.
    fn each<T>(
        &mut self,
        items: &'a [Json],
        read: fn(&mut Self, &'a Json) -> Result<T, SchemaBuildError>,
    ) -> Result<Vec<T>, SchemaBuildError> {
        let mut values = Vec::with_capacity(items.len());
        for (index, item) in items.iter().enumerate() {
            values.push(self.at(&index.to_string(), |loader| read(loader, item))?);
        }
        Ok(values)
    }

    fn literal(&mut self, json: &'a Json) -> Result<SchemaLiteral, SchemaBuildError> {
        match json {
            Json::Null => Ok(SchemaLiteral::Null),
            Json::Bool(value) => Ok(SchemaLiteral::Boolean(*value)),
            Json::Number(value) => Ok(SchemaLiteral::Number(*value)),
            Json::String(value) => Ok(SchemaLiteral::String(value.clone())),
            // where a later form would hold `undefined` or a bigint
            Json::Array(_) | Json::Object(_) => {
                Err(self.error(SchemaBuildErrorKind::UnsupportedLiteral))
            }
        }
    }
}

#[cfg(test)]
mod tests;
