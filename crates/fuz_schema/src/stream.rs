//! The streaming evaluator: a verdict reached while the text is parsed, with
//! no tree, that stops at the first failure.
//!
//! It is a serde visitor per node. A scalar goes to the tree evaluator's
//! `run`, so the two read every kind the same way. An array or object is
//! matched as its items and keys arrive. Two shapes need the whole value
//! before anything can be said, and are read into a tree and walked: an array
//! or object that more than one option of a `union` could match, and a
//! `variant` whose discriminator is not the object's first key.
//!
//! A `union` knows from when it was built which of its options could match an
//! array, and which an object. With one, the array or object is matched
//! against that option as it arrives. With none, it fails unread.
//!
//! The verdict can be stricter than the tree evaluator's, and is never
//! looser:
//!
//! - Every occurrence of a repeated key is checked, where JavaScript keeps
//!   the last.
//! - What follows the first failure is not read, so a text that fails and is
//!   then malformed is `false` and not an error.
//!
//! And a value that needs no reading is skipped, so a number or an escape the
//! parser would refuse goes unseen there.

use std::cell::Cell;
use std::fmt;

use serde::de::{self, DeserializeSeed, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};

use crate::bits::Bits;
use crate::error::JsonError;
use crate::js;
use crate::json::{self, JsonSeed, Value};
use crate::schema::{Candidates, Container, NodeId, Schema, SchemaEntries, SchemaNode, VariantDef};
use crate::walk::{self, Probe};

/// Whether `text` is JSON that matches `schema`.
pub fn matches_json(schema: &Schema, text: &str) -> Result<bool, JsonError> {
    let context = Context {
        schema,
        failed: Cell::new(false),
    };
    let mut deserializer = serde_json::Deserializer::from_str(text);
    let seed = NodeSeed {
        context: &context,
        id: schema.root(),
    };
    match seed
        .deserialize(&mut deserializer)
        .and_then(|()| deserializer.end())
    {
        Ok(()) => Ok(true),
        Err(_) if context.failed.get() => Ok(false),
        Err(error) => Err(JsonError::from_serde(&error)),
    }
}

struct Context<'a> {
    schema: &'a Schema,
    /// Set when the value does not match, which is told apart from a parse
    /// error by this and nothing else.
    failed: Cell<bool>,
}

impl Context<'_> {
    /// The error that ends the parse because the value does not match.
    fn fail<E: de::Error>(&self) -> E {
        self.failed.set(true);
        E::custom("")
    }

    fn verdict<E: de::Error>(&self, matched: bool) -> Result<(), E> {
        if matched { Ok(()) } else { Err(self.fail()) }
    }
}

/// Matches the next value against a node.
#[derive(Clone, Copy)]
struct NodeSeed<'a> {
    context: &'a Context<'a>,
    id: NodeId,
}

impl<'a> NodeSeed<'a> {
    const fn at(self, id: NodeId) -> Self {
        Self {
            context: self.context,
            id,
        }
    }

    /// Matches a value that is whole: a scalar, or an array or object that
    /// was read into a tree.
    fn walk<E: de::Error>(self, value: Value<'_>) -> Result<(), E> {
        // a probe for this walk alone: the tree is dropped after it, and the
        // next tree read can have its addresses
        let matched = walk::run(self.context.schema, self.id, value, &mut Probe::default());
        self.context.verdict(matched)
    }

    /// The entries of an object schema against the keys left in `map`.
    ///
    /// `seen` holds the entries already matched, and `hint` is where the next
    /// key is if the input is in the schema's order.
    fn entries<'de, A: MapAccess<'de>>(
        self,
        entries: &SchemaEntries,
        strict: bool,
        mut map: A,
        mut seen: Bits,
        mut hint: usize,
    ) -> Result<(), A::Error> {
        while let Some(found) = map.next_key_seed(KeySeed { entries, hint })? {
            if let Some(position) = found {
                hint = position + 1;
                seen.insert(position);
                map.next_value_seed(self.at(entries.schema_at(position)))?;
            } else if strict {
                return Err(self.context.fail());
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        // an entry not seen had a missing key, which only some accept, and one
        // that reaches an `unknown` does not
        self.context.verdict(seen.is_superset(entries.required()))
    }

    fn variant<'de, A: MapAccess<'de>>(
        self,
        variant: &'a VariantDef,
        mut map: A,
    ) -> Result<(), A::Error> {
        let schema = self.context.schema;
        let first = map.next_key_seed(FirstKeySeed { key: variant.key() })?;
        match first {
            // no key, so no discriminator
            None => Err(self.context.fail()),
            Some(FirstKey::Discriminator) => {
                let selected = map.next_value_seed(SelectSeed {
                    context: self.context,
                    variant,
                })?;
                let option = selected.map(|option| schema.at(option));
                let Some(entries) = option.and_then(SchemaNode::entries) else {
                    return Err(self.context.fail());
                };
                let strict = matches!(option, Some(SchemaNode::Object(_)));
                // the option's entry at the discriminator is the literal that
                // selected it
                let mut seen = Bits::new(entries.len());
                let position = entries.position(variant.key());
                if let Some(position) = position {
                    seen.insert(position);
                }
                let hint = position.map_or(0, |position| position + 1);
                self.entries(entries, strict, map, seen, hint)
            }
            // the discriminator is wherever its last occurrence is
            Some(FirstKey::Other(key)) => {
                let value = map.next_value_seed(JsonSeed)?;
                let object = json::read_object(vec![(key, value)], map)?;
                self.walk(Value::Object(&object))
            }
        }
    }
}

impl<'de> DeserializeSeed<'de> for NodeSeed<'_> {
    type Value = ();

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        if self.context.schema.accepts_any(self.id) {
            // nothing to check, so nothing is read
            deserializer.deserialize_ignored_any(IgnoredAny).map(drop)
        } else {
            deserializer.deserialize_any(self)
        }
    }
}

impl<'de> Visitor<'de> for NodeSeed<'_> {
    type Value = ();

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a JSON value")
    }

    fn visit_unit<E: de::Error>(self) -> Result<(), E> {
        self.walk(Value::Null)
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<(), E> {
        self.walk(Value::Bool(value))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<(), E> {
        self.walk(Value::Number(json::number_from_u64(value)))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<(), E> {
        self.walk(Value::Number(json::number_from_i64(value)))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<(), E> {
        self.walk(Value::Number(value))
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<(), E> {
        self.walk(Value::String(value))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        let schema = self.context.schema;
        let mut id = self.id;
        // the length actions of the pipes around the array
        let mut min = f64::NEG_INFINITY;
        let mut max = f64::INFINITY;
        loop {
            match schema.at(id) {
                // an array is neither a missing key nor `null`
                SchemaNode::Optional(inner)
                | SchemaNode::Nullable(inner)
                | SchemaNode::Lazy(inner) => id = *inner,
                SchemaNode::WithDefault(default) => id = default.schema(),
                SchemaNode::Pipe(steps) => {
                    // `build` refuses a pipe with no schema
                    let Some((&head, actions)) = steps.split_first() else {
                        return Err(self.context.fail());
                    };
                    for &action in actions {
                        match schema.at(action) {
                            SchemaNode::MinLength(bound) => min = min.max(*bound),
                            SchemaNode::MaxLength(bound) => max = max.min(*bound),
                            // an action for a number, which an array is not
                            _ => return Err(self.context.fail()),
                        }
                    }
                    id = head;
                }
                SchemaNode::Array(inner) => {
                    let item = self.at(*inner);
                    let mut length = 0;
                    while seq.next_element_seed(item)?.is_some() {
                        length += 1;
                        if js::length_number(length) > max {
                            return Err(self.context.fail());
                        }
                    }
                    return self.context.verdict(js::length_number(length) >= min);
                }
                SchemaNode::Union(_) => match schema.candidates(id, Container::Array) {
                    Candidates::One(option) => id = option,
                    // which option matches is not known until the array is whole
                    Candidates::Many => {
                        let array = JsonSeed.visit_seq(seq)?;
                        return self.walk(array.view());
                    }
                    Candidates::None => return Err(self.context.fail()),
                },
                // `unknown` is skipped before it gets here, and nothing else
                // matches an array
                _ => return Err(self.context.fail()),
            }
        }
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        let schema = self.context.schema;
        let mut id = self.id;
        loop {
            match schema.at(id) {
                // an object is neither a missing key nor `null`
                SchemaNode::Optional(inner)
                | SchemaNode::Nullable(inner)
                | SchemaNode::Lazy(inner) => id = *inner,
                SchemaNode::WithDefault(default) => id = default.schema(),
                SchemaNode::Object(entries) => {
                    return self.entries(entries, true, map, Bits::new(entries.len()), 0);
                }
                SchemaNode::LooseObject(entries) | SchemaNode::StripObject(entries) => {
                    return self.entries(entries, false, map, Bits::new(entries.len()), 0);
                }
                SchemaNode::Record(inner) => {
                    let value = self.at(*inner);
                    while map.next_key::<IgnoredAny>()?.is_some() {
                        map.next_value_seed(value)?;
                    }
                    return Ok(());
                }
                SchemaNode::Variant(variant) => return self.variant(variant, map),
                SchemaNode::Union(_) => match schema.candidates(id, Container::Object) {
                    Candidates::One(option) => id = option,
                    // which option matches is not known until the object is whole
                    Candidates::Many => {
                        let object = json::read_object(Vec::new(), map)?;
                        return self.walk(Value::Object(&object));
                    }
                    Candidates::None => return Err(self.context.fail()),
                },
                // `unknown` is skipped before it gets here, a pipe starts with
                // a string, a number, or an array, and nothing else matches an
                // object
                _ => return Err(self.context.fail()),
            }
        }
    }
}

/// Reads a key as the position of its entry.
struct KeySeed<'a> {
    entries: &'a SchemaEntries,
    hint: usize,
}

impl<'de> DeserializeSeed<'de> for KeySeed<'_> {
    type Value = Option<usize>;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_str(self)
    }
}

impl Visitor<'_> for KeySeed<'_> {
    type Value = Option<usize>;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a key")
    }

    fn visit_str<E: de::Error>(self, key: &str) -> Result<Self::Value, E> {
        Ok(self.entries.position_from(self.hint, key))
    }
}

/// The first key of an object a `variant` is matching.
enum FirstKey {
    Discriminator,
    Other(Box<str>),
}

struct FirstKeySeed<'a> {
    key: &'a str,
}

impl<'de> DeserializeSeed<'de> for FirstKeySeed<'_> {
    type Value = FirstKey;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<FirstKey, D::Error> {
        deserializer.deserialize_str(self)
    }
}

impl Visitor<'_> for FirstKeySeed<'_> {
    type Value = FirstKey;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a key")
    }

    fn visit_str<E: de::Error>(self, key: &str) -> Result<FirstKey, E> {
        Ok(if key == self.key {
            FirstKey::Discriminator
        } else {
            FirstKey::Other(key.into())
        })
    }
}

/// Reads the value at a discriminator as the option it selects.
struct SelectSeed<'a> {
    context: &'a Context<'a>,
    variant: &'a VariantDef,
}

impl<'de> DeserializeSeed<'de> for SelectSeed<'_> {
    type Value = Option<NodeId>;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for SelectSeed<'_> {
    type Value = Option<NodeId>;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a JSON value")
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(self.variant.select(Value::Null))
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Self::Value, E> {
        Ok(self.variant.select(Value::Bool(value)))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Self::Value, E> {
        Ok(self
            .variant
            .select(Value::Number(json::number_from_u64(value))))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Self::Value, E> {
        Ok(self
            .variant
            .select(Value::Number(json::number_from_i64(value))))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Self::Value, E> {
        Ok(self.variant.select(Value::Number(value)))
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
        Ok(self.variant.select(Value::String(value)))
    }

    // a discriminator is a literal, which an array or object never equals

    fn visit_seq<A: SeqAccess<'de>>(self, _: A) -> Result<Self::Value, A::Error> {
        Err(self.context.fail())
    }

    fn visit_map<A: MapAccess<'de>>(self, _: A) -> Result<Self::Value, A::Error> {
        Err(self.context.fail())
    }
}

#[cfg(test)]
mod tests;
