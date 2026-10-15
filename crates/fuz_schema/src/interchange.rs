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
mod tests {
    use super::*;
    use crate::error::JsonErrorKind;
    use crate::schema::{MAX_NESTING, SchemaNode};

    fn load(schema: &str) -> Schema {
        Schema::from_json(&format!(r#"{{"schema":{schema}}}"#))
            .unwrap_or_else(|error| panic!("{schema}: {error}"))
    }

    fn refusal(document: &str) -> (SchemaBuildErrorKind, String) {
        let error = Schema::from_json(document).unwrap_err();
        (error.kind().clone(), error.path().to_owned())
    }

    fn malformed(expected: &'static str) -> SchemaBuildErrorKind {
        SchemaBuildErrorKind::Malformed { expected }
    }

    fn unexpected(key: &str) -> SchemaBuildErrorKind {
        SchemaBuildErrorKind::UnexpectedKey { key: key.into() }
    }

    /// One schema of every kind, a text it matches, and one it does not.
    const EVERY_KIND: [(&str, &str, &str); 25] = [
        (r#"{"kind":"string"}"#, r#""a""#, "1"),
        (r#"{"kind":"number"}"#, "1.5", r#""1""#),
        (r#"{"kind":"boolean"}"#, "false", "0"),
        (r#"{"kind":"bigint"}"#, "", "1"),
        (r#"{"kind":"unknown"}"#, "[null]", ""),
        (r#"{"kind":"literal","def":"a"}"#, r#""a""#, r#""b""#),
        (
            r#"{"kind":"one_of","def":["a",1,null,false]}"#,
            "null",
            "true",
        ),
        (
            r#"{"kind":"object","def":{"a":{"kind":"optional","def":{"schema":{"kind":"string"}}}}}"#,
            "{}",
            r#"{"a":null}"#,
        ),
        (
            r#"{"kind":"nullable","def":{"schema":{"kind":"string"}}}"#,
            "null",
            "1",
        ),
        (
            r#"{"kind":"object","def":{"a":{"kind":"with_default","def":{"schema":{"kind":"number"},"value":{"any":[1,null]}}}}}"#,
            "{}",
            r#"{"a":"1"}"#,
        ),
        (
            r#"{"kind":"array","def":{"kind":"lazy","def":"$0"}}"#,
            "[[],[[]]]",
            "[1]",
        ),
        (
            r#"{"kind":"object","def":{"id":{"kind":"number"},"name":{"kind":"string"}}}"#,
            r#"{"name":"a","id":1}"#,
            r#"{"name":"a","id":1,"x":1}"#,
        ),
        (
            r#"{"kind":"loose_object","def":{"id":{"kind":"number"}}}"#,
            r#"{"id":1,"x":1}"#,
            "{}",
        ),
        (r#"{"kind":"strip_object","def":{}}"#, r#"{"x":1}"#, "[]"),
        (
            r#"{"kind":"record","def":{"kind":"number"}}"#,
            r#"{"a":1}"#,
            r#"{"a":"1"}"#,
        ),
        (
            r#"{"kind":"array","def":{"kind":"string"}}"#,
            r#"["a"]"#,
            "[1]",
        ),
        (
            r#"{"kind":"union","def":[{"kind":"string"},{"kind":"number"}]}"#,
            "1",
            "null",
        ),
        (
            r#"{"kind":"variant","def":{"key":"kind","options":[{"kind":"object","def":{"kind":{"kind":"literal","def":"a"}}}]}}"#,
            r#"{"kind":"a"}"#,
            r#"{"kind":"b"}"#,
        ),
        (
            r#"{"kind":"pipe","def":[{"kind":"number"},{"kind":"integer"},{"kind":"min_value","def":0},{"kind":"max_value","def":150}]}"#,
            "150",
            "150.5",
        ),
        (
            r#"{"kind":"pipe","def":[{"kind":"string"},{"kind":"min_length","def":1}]}"#,
            r#""a""#,
            r#""""#,
        ),
        (
            r#"{"kind":"pipe","def":[{"kind":"array","def":{"kind":"unknown"}},{"kind":"max_length","def":1}]}"#,
            "[1]",
            "[1,2]",
        ),
        (
            r#"{"kind":"pipe","def":[{"kind":"number"},{"kind":"min_value","def":-0.5}]}"#,
            "-0.5",
            "-1",
        ),
        (
            r#"{"kind":"pipe","def":[{"kind":"number"},{"kind":"max_value","def":1e21}]}"#,
            "1e21",
            "1e22",
        ),
        (r#"{"kind":"integer"}"#, "1e2", "1.5"),
        (
            r#"{"kind":"safe_integer"}"#,
            "9007199254740991",
            "9007199254740992",
        ),
    ];

    #[test]
    fn every_kind_loads() {
        let mut kinds = Vec::new();
        for (schema, valid, invalid) in EVERY_KIND {
            let document = format!(r#"{{"schema":{schema},"defs":{{"$0":{schema}}}}}"#);
            let schema =
                Schema::from_json(&document).unwrap_or_else(|error| panic!("{document}: {error}"));
            kinds.extend(schema.nodes().map(SchemaNode::kind));
            for (text, expected) in [(valid, true), (invalid, false)] {
                // an empty text stands for a kind with nothing on that side
                if !text.is_empty() {
                    assert_eq!(
                        schema.matches_json(text),
                        Ok(expected),
                        "{document} on {text}"
                    );
                    assert_eq!(
                        schema.matches_json_exact(text),
                        Ok(expected),
                        "{document} on {text}"
                    );
                }
            }
        }
        for kind in SchemaKind::ALL {
            assert!(kinds.contains(kind), "{kind}");
        }
    }

    #[test]
    fn a_document_reads_whatever_the_order_of_its_keys() {
        let schema = Schema::from_json(
            r#"{"defs":{"tree":{"def":{"children":{"def":{"def":"tree","kind":"lazy"},"kind":"array"}},"kind":"object"}},"schema":{"def":"tree","kind":"lazy"}}"#,
        )
        .unwrap();
        assert_eq!(
            schema.matches_json(r#"{"children":[{"children":[]}]}"#),
            Ok(true)
        );
        assert_eq!(schema.matches_json(r#"{"children":[{}]}"#), Ok(false));
    }

    #[test]
    fn names_can_be_anything() {
        let schema = Schema::from_json(
            r#"{"schema":{"kind":"array","def":{"kind":"lazy","def":""}},"defs":{"":{"kind":"lazy","def":"a/b"},"a/b":{"kind":"number"},"kind":{"kind":"string"}}}"#,
        )
        .unwrap();
        assert_eq!(schema.matches_json("[1]"), Ok(true));
        assert_eq!(schema.matches_json(r#"["a"]"#), Ok(false));
    }

    #[test]
    fn entries_can_have_the_names_of_the_form() {
        let schema = load(
            r#"{"kind":"object","def":{"kind":{"kind":"string"},"def":{"kind":"number"},"schema":{"kind":"boolean"}}}"#,
        );
        assert_eq!(
            schema.matches_json(r#"{"kind":"a","def":1,"schema":true}"#),
            Ok(true)
        );
    }

    #[test]
    fn text_that_is_not_json_is_refused() {
        let (kind, path) = refusal(r#"{"schema":"#);
        let SchemaBuildErrorKind::Json(error) = kind else {
            panic!("{kind:?}");
        };
        assert_eq!(error.kind(), JsonErrorKind::Eof);
        assert_eq!(path, "");
        // a number that is not finite can only be written as one JSON refuses
        let (kind, _) = refusal(r#"{"schema":{"kind":"literal","def":1e400}}"#);
        assert!(
            matches!(kind, SchemaBuildErrorKind::Json(error) if error.kind() == JsonErrorKind::NumberOutOfRange)
        );
    }

    #[test]
    fn a_key_written_twice_is_refused() {
        let string = r#"{"kind":"string"}"#;
        for (document, key, path) in [
            (
                r#"{"schema":{"kind":"string","kind":"number"}}"#.to_owned(),
                "kind",
                "/schema/kind",
            ),
            (
                format!(r#"{{"schema":{string},"schema":{string}}}"#),
                "schema",
                "/schema",
            ),
            (
                format!(
                    r#"{{"schema":{string},"defs":{{"a":{string},"b":{string},"a":{string}}}}}"#
                ),
                "a",
                "/defs/a",
            ),
            (
                format!(
                    r#"{{"schema":{{"kind":"object","def":{{"a/b":{string},"a/b":{string}}}}}}}"#
                ),
                "a/b",
                "/schema/def/a~1b",
            ),
            (
                format!(
                    r#"{{"schema":{{"kind":"union","def":[{string},{{"kind":"literal","def":1,"def":2}}]}}}}"#
                ),
                "def",
                "/schema/def/1/def",
            ),
            // the same key, however it is written
            (
                r#"{"schema":{"kind":"string","\u006bind":"number"}}"#.to_owned(),
                "kind",
                "/schema/kind",
            ),
            // in a default, which is data, as anywhere else
            (
                format!(
                    r#"{{"schema":{{"kind":"with_default","def":{{"schema":{string},"value":[{{"x":1,"x":2}}]}}}}}}"#
                ),
                "x",
                "/schema/def/value/0/x",
            ),
            // the first one written is the one named
            (
                format!(
                    r#"{{"schema":{string},"defs":{{"a":{string},"a":{{"kind":"string","kind":1}}}}}}"#
                ),
                "a",
                "/defs/a",
            ),
        ] {
            assert_eq!(
                refusal(&document),
                (
                    SchemaBuildErrorKind::RepeatedKey { key: key.into() },
                    path.to_owned()
                ),
                "{document}"
            );
        }
        // text that is not JSON is that first
        let (kind, _) = refusal(r#"{"schema":{"kind":"string","kind":"number"}"#);
        assert!(matches!(kind, SchemaBuildErrorKind::Json(_)), "{kind:?}");
        // and a JSON text keeps the last value of a key, as it did
        let schema = load(r#"{"kind":"record","def":{"kind":"number"}}"#);
        assert_eq!(schema.matches_json_exact(r#"{"a":"x","a":1}"#), Ok(true));
    }

    #[test]
    fn a_document_is_read_as_deep_as_any_text() {
        use crate::json::MAX_DEPTH;
        // the envelope, then an array schema per level
        let nested = |depth: usize| {
            format!(
                r#"{{"schema":{}{{"kind":"string"}}{}}}"#,
                r#"{"kind":"array","def":"#.repeat(depth),
                "}".repeat(depth)
            )
        };
        assert!(Schema::from_json(&nested(MAX_DEPTH - 2)).is_ok());
        let (kind, path) = refusal(&nested(MAX_DEPTH - 1));
        assert!(
            matches!(&kind, SchemaBuildErrorKind::Json(error) if error.kind() == JsonErrorKind::DepthLimit),
            "{kind:?}"
        );
        assert_eq!(path, "");
    }

    /// `contract.json`, which the TypeScript side generates from its own
    /// constants.
    fn contract_strings(key: &str) -> Vec<String> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src/test/fixtures/json/contract.json"
        );
        let text = std::fs::read_to_string(path).unwrap();
        let contract: serde_json::Value = serde_json::from_str(&text).unwrap();
        contract[key]
            .as_array()
            .unwrap_or_else(|| panic!("no array `{key}`"))
            .iter()
            .map(|item| item.as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn the_names_refused_are_the_contracts() {
        assert_eq!(contract_strings("unsupported_kinds"), UNSUPPORTED_KINDS);
        assert_eq!(
            contract_strings("object_prototype_keys"),
            crate::js::OBJECT_PROTOTYPE_KEYS
        );
    }

    #[test]
    fn a_malformed_document_is_refused() {
        let schema = "a schema, an object with a `kind`";
        for (document, kind, path) in [
            ("[]", malformed("an object with a `schema`"), ""),
            ("{}", malformed("a `schema`"), ""),
            (
                r#"{"schema":{"kind":"string"},"other":1}"#,
                unexpected("other"),
                "/other",
            ),
            (
                r#"{"schema":{"kind":"string"},"defs":[]}"#,
                malformed("an object of schemas by name"),
                "/defs",
            ),
            (r#"{"schema":null}"#, malformed(schema), "/schema"),
            (r#"{"schema":"string"}"#, malformed(schema), "/schema"),
            (r#"{"schema":{}}"#, malformed(schema), "/schema"),
            (r#"{"schema":{"def":1}}"#, malformed(schema), "/schema"),
            (
                r#"{"schema":{"kind":1}}"#,
                malformed("a string"),
                "/schema/kind",
            ),
            (
                r#"{"schema":{"kind":"string","run":1}}"#,
                unexpected("run"),
                "/schema/run",
            ),
            (
                r#"{"schema":{"kind":"string","def":null}}"#,
                unexpected("def"),
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"integer","def":1}}"#,
                unexpected("def"),
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"string"},"defs":{"a~b/c":{"kind":"array","def":[]}}}"#,
                malformed(schema),
                "/defs/a~0b~1c/def",
            ),
            (
                r#"{"schema":{"kind":"one_of"}}"#,
                malformed("a `def`, an array of literals"),
                "/schema",
            ),
            (
                r#"{"schema":{"kind":"one_of","def":"a"}}"#,
                malformed("an array of literals"),
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"optional"}}"#,
                malformed("a `def` with a `schema`"),
                "/schema",
            ),
            (
                r#"{"schema":{"kind":"optional","def":{"kind":"string"}}}"#,
                unexpected("kind"),
                "/schema/def/kind",
            ),
            (
                r#"{"schema":{"kind":"nullable","def":{}}}"#,
                malformed("an object with a `schema`"),
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"with_default","def":{"schema":{"kind":"string"}}}}"#,
                malformed("an object with a `schema` and a `value`"),
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"with_default","def":{"schema":{"kind":"string"},"value":1,"x":1}}}"#,
                unexpected("x"),
                "/schema/def/x",
            ),
            (
                r#"{"schema":{"kind":"lazy","def":1}}"#,
                malformed("the name of a schema"),
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"lazy"}}"#,
                malformed("a `def`, the name of a schema"),
                "/schema",
            ),
            (
                r#"{"schema":{"kind":"object","def":[]}}"#,
                malformed("an object of entries"),
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"object","def":{"a":1}}}"#,
                malformed(schema),
                "/schema/def/a",
            ),
            (
                r#"{"schema":{"kind":"array"}}"#,
                malformed("a `def`, a schema"),
                "/schema",
            ),
            (
                r#"{"schema":{"kind":"record","def":[]}}"#,
                malformed(schema),
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"union","def":{}}}"#,
                malformed("an array of schemas"),
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"union","def":[{"kind":"string"},1]}}"#,
                malformed(schema),
                "/schema/def/1",
            ),
            (
                r#"{"schema":{"kind":"variant","def":{"key":"k"}}}"#,
                malformed("an object with a `key` and `options`"),
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"variant","def":{"key":1,"options":[]}}}"#,
                malformed("a string"),
                "/schema/def/key",
            ),
            (
                r#"{"schema":{"kind":"variant","def":{"key":"k","options":{}}}}"#,
                malformed("an array of object schemas"),
                "/schema/def/options",
            ),
            (
                r#"{"schema":{"kind":"variant","def":{"key":"k","options":[],"x":1}}}"#,
                unexpected("x"),
                "/schema/def/x",
            ),
            (
                r#"{"schema":{"kind":"pipe","def":[{"kind":"string"},{"kind":"min_length","def":"1"}]}}"#,
                malformed("a number"),
                "/schema/def/1/def",
            ),
            (
                r#"{"schema":{"kind":"pipe","def":[{"kind":"string"},{"kind":"min_length"}]}}"#,
                malformed("a `def`, a number"),
                "/schema/def/1",
            ),
        ] {
            assert_eq!(refusal(document), (kind, path.to_owned()), "{document}");
        }
    }

    #[test]
    fn what_is_not_portable_is_refused() {
        for kind in UNSUPPORTED_KINDS {
            assert_eq!(
                refusal(&format!(
                    r#"{{"schema":{{"kind":"pipe","def":[{{"kind":"string"}},{{"kind":"{kind}"}}]}}}}"#
                )),
                (
                    SchemaBuildErrorKind::UnsupportedKind { kind },
                    "/schema/def/1".to_owned()
                )
            );
        }
        // `object_with_rest` is the library's, and not yet carried here
        for kind in ["date", "String", "", "min_len", "object_with_rest"] {
            assert_eq!(
                refusal(&format!(r#"{{"schema":{{"kind":"{kind}"}}}}"#)),
                (
                    SchemaBuildErrorKind::UnknownKind { kind: kind.into() },
                    "/schema".to_owned()
                )
            );
        }
        for (document, path) in [
            // with no `def` the literal is `undefined`
            (r#"{"schema":{"kind":"literal"}}"#, "/schema"),
            (
                r#"{"schema":{"kind":"literal","def":{"bigint":"1"}}}"#,
                "/schema/def",
            ),
            (r#"{"schema":{"kind":"literal","def":[]}}"#, "/schema/def"),
            (
                r#"{"schema":{"kind":"one_of","def":[1,{"undefined":true}]}}"#,
                "/schema/def/1",
            ),
        ] {
            assert_eq!(
                refusal(document),
                (SchemaBuildErrorKind::UnsupportedLiteral, path.to_owned()),
                "{document}"
            );
        }
    }

    #[test]
    fn what_the_builder_refuses_has_a_path_into_the_document() {
        let string = r#"{"kind":"string"}"#;
        let bound = r#"{"kind":"min_length","def":1}"#;
        for (document, kind, path) in [
            (
                format!(r#"{{"schema":{{"kind":"array","def":{{"kind":"object","def":{{"ok":{string},"toString":{string}}}}}}}}}"#),
                SchemaBuildErrorKind::PrototypeKey { key: "toString".into() },
                "/schema/def/def/toString",
            ),
            (
                format!(r#"{{"schema":{{"kind":"loose_object","def":{{"__proto__":{string}}}}}}}"#),
                SchemaBuildErrorKind::PrototypeKey { key: "__proto__".into() },
                "/schema/def/__proto__",
            ),
            (
                r#"{"schema":{"kind":"variant","def":{"key":"toString","options":[]}}}"#.to_owned(),
                SchemaBuildErrorKind::PrototypeKey { key: "toString".into() },
                "/schema/def/key",
            ),
            (
                r#"{"schema":{"kind":"variant","def":{"key":"toString","options":[{"kind":"object","def":{"toString":{"kind":"literal","def":"a"}}}]}}}"#.to_owned(),
                SchemaBuildErrorKind::PrototypeKey { key: "toString".into() },
                "/schema/def/options/0/def/toString",
            ),
            (
                r#"{"schema":{"kind":"pipe","def":[]}}"#.to_owned(),
                SchemaBuildErrorKind::EmptyPipe,
                "/schema",
            ),
            (
                format!(r#"{{"schema":{{"kind":"pipe","def":[{{"kind":"unknown"}},{bound}]}}}}"#),
                SchemaBuildErrorKind::PipeHead { kind: SchemaKind::Unknown },
                "/schema/def/0",
            ),
            (
                format!(r#"{{"schema":{{"kind":"pipe","def":[{string},{string}]}}}}"#),
                SchemaBuildErrorKind::PipeStep { kind: SchemaKind::String },
                "/schema/def/1",
            ),
            (
                format!(r#"{{"schema":{{"kind":"pipe","def":[{{"kind":"number"}},{bound}]}}}}"#),
                SchemaBuildErrorKind::ActionMismatch { kind: SchemaKind::MinLength },
                "/schema/def/1",
            ),
            (
                format!(r#"{{"schema":{{"kind":"object","def":{{"a/b":{bound}}}}}}}"#),
                SchemaBuildErrorKind::ActionOutsidePipe { kind: SchemaKind::MinLength },
                "/schema/def/a~1b",
            ),
            (
                format!(r#"{{"schema":{bound}}}"#),
                SchemaBuildErrorKind::ActionOutsidePipe { kind: SchemaKind::MinLength },
                "/schema",
            ),
            (
                format!(r#"{{"schema":{{"kind":"lazy","def":"a"}},"defs":{{"a":{bound}}}}}"#),
                SchemaBuildErrorKind::ActionOutsidePipe { kind: SchemaKind::MinLength },
                "/defs/a",
            ),
            (
                format!(r#"{{"schema":{{"kind":"variant","def":{{"key":"k","options":[{string}]}}}}}}"#),
                SchemaBuildErrorKind::VariantOption { kind: SchemaKind::String },
                "/schema/def/options/0",
            ),
            (
                format!(r#"{{"schema":{{"kind":"variant","def":{{"key":"k","options":[{{"kind":"object","def":{{"k":{string}}}}}]}}}}}}"#),
                SchemaBuildErrorKind::VariantDiscriminator { key: "k".into() },
                "/schema/def/options/0",
            ),
            (
                r#"{"schema":{"kind":"array","def":{"kind":"lazy","def":"missing"}},"defs":{"other":{"kind":"string"}}}"#.to_owned(),
                SchemaBuildErrorKind::UnresolvedLazy { name: "missing".into() },
                "/schema/def/def",
            ),
            (
                r#"{"schema":{"kind":"lazy","def":"$0"}}"#.to_owned(),
                SchemaBuildErrorKind::UnresolvedLazy { name: "$0".into() },
                "/schema/def",
            ),
            (
                r#"{"schema":{"kind":"lazy","def":"a"},"defs":{"a":{"kind":"nullable","def":{"schema":{"kind":"lazy","def":"a"}}}}}"#.to_owned(),
                SchemaBuildErrorKind::UnguardedRecursion,
                "/defs/a",
            ),
            (
                r#"{"schema":{"kind":"string"},"defs":{"a":{"kind":"lazy","def":"b"},"b":{"kind":"union","def":[{"kind":"lazy","def":"a"}]}}}"#.to_owned(),
                SchemaBuildErrorKind::UnguardedRecursion,
                "/defs/b",
            ),
        ] {
            assert_eq!(refusal(&document), (kind, path.to_owned()), "{document}");
        }
    }

    #[test]
    fn a_definition_nothing_refers_to_is_checked() {
        assert_eq!(
            refusal(r#"{"schema":{"kind":"string"},"defs":{"unused":{"kind":"pipe","def":[]}}}"#),
            (SchemaBuildErrorKind::EmptyPipe, "/defs/unused".to_owned())
        );
        assert_eq!(
            refusal(r#"{"schema":{"kind":"string"},"defs":{"unused":{"kind":"regex"}}}"#),
            (
                SchemaBuildErrorKind::UnsupportedKind { kind: "regex" },
                "/defs/unused".to_owned()
            )
        );
    }

    #[test]
    fn nesting_past_the_limit_is_refused() {
        let nested = |depth: usize| {
            format!(
                r#"{{"schema":{}{{"kind":"string"}}{}}}"#,
                r#"{"kind":"nullable","def":{"schema":"#.repeat(depth),
                "}}".repeat(depth)
            )
        };
        assert!(Schema::from_json(&nested(MAX_NESTING)).is_ok());
        assert_eq!(
            refusal(&nested(MAX_NESTING + 1)),
            (
                SchemaBuildErrorKind::TooNested { limit: MAX_NESTING },
                "/schema".to_owned()
            )
        );
    }
}
