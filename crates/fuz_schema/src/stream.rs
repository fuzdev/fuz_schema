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
        let matched = walk::run(self.context.schema, self.id, value, &mut Probe);
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
        // an entry not seen had a missing key, which only some accept
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
mod tests {
    use super::*;
    use crate::builder::SchemaBuilder;
    use crate::error::JsonErrorKind;
    use crate::schema::SchemaLiteral;
    use crate::walk::tests::build;

    fn check(schema: &Schema, valid: &[&str], invalid: &[&str]) {
        for text in valid {
            assert_eq!(matches_json(schema, text), Ok(true), "{text}");
        }
        for text in invalid {
            assert_eq!(matches_json(schema, text), Ok(false), "{text}");
        }
    }

    fn error(schema: &Schema, text: &str) -> JsonErrorKind {
        matches_json(schema, text).unwrap_err().kind()
    }

    fn numbers() -> Schema {
        build(|b| {
            let number = b.number();
            b.array(number)
        })
    }

    fn person() -> Schema {
        build(|b| {
            let string = b.string();
            let number = b.number();
            let optional = b.optional(number);
            b.object([("name", string), ("age", optional)])
        })
    }

    #[test]
    fn the_first_failure_ends_the_parse() {
        let numbers = numbers();
        check(&numbers, &["[]", "[1,2]"], &[r#"["x",2]"#, "{}", "1"]);
        // what follows the failure is not read, malformed or not
        check(
            &numbers,
            &[],
            &[
                r#"["x",}"#,
                r#"["x""#,
                "[null,1e400]",
                r#"[[], "\ud800"]"#,
                r#"{"a":"#,
            ],
        );
        // and what comes before it is
        assert_eq!(error(&numbers, r#"[1,} "x"]"#), JsonErrorKind::Syntax);
        assert_eq!(error(&numbers, "[1,"), JsonErrorKind::Eof);
        // a scalar is a whole token before it is anything else
        assert_eq!(error(&numbers, r#""unterminated"#), JsonErrorKind::Eof);
        assert_eq!(error(&numbers, "nul"), JsonErrorKind::Eof);
        assert_eq!(error(&numbers, r#"[1,"\x"]"#), JsonErrorKind::Syntax);
        assert_eq!(error(&numbers, "[1e400]"), JsonErrorKind::NumberOutOfRange);
    }

    #[test]
    fn a_match_reads_to_the_end_of_the_text() {
        let numbers = numbers();
        assert_eq!(error(&numbers, "[1] x"), JsonErrorKind::Syntax);
        assert_eq!(error(&numbers, "[1]]"), JsonErrorKind::Syntax);
        assert_eq!(error(&numbers, "[1"), JsonErrorKind::Eof);
        assert_eq!(error(&numbers, ""), JsonErrorKind::Eof);
        check(&numbers, &[" [ 1 , 2 ] \n"], &[]);
        let unknown = build(SchemaBuilder::unknown);
        assert_eq!(error(&unknown, "1 2"), JsonErrorKind::Syntax);
        assert_eq!(error(&unknown, "[1,]"), JsonErrorKind::Syntax);
        assert_eq!(error(&unknown, ""), JsonErrorKind::Eof);
    }

    #[test]
    fn every_occurrence_of_a_key_must_match() {
        let person = person();
        check(
            &person,
            &[r#"{"name":"a","name":"b"}"#],
            // the tree evaluator, like JavaScript, sees only the last
            &[
                r#"{"name":1,"name":"b"}"#,
                r#"{"name":"a","age":"x","age":1}"#,
            ],
        );
        for text in [
            r#"{"name":1,"name":"b"}"#,
            r#"{"name":"a","age":"x","age":1}"#,
        ] {
            assert_eq!(walk::matches_json(&person, text), Ok(true), "{text}");
        }
        let record = build(|b| {
            let number = b.number();
            b.record(number)
        });
        check(&record, &[r#"{"a":1,"a":2}"#], &[r#"{"a":"x","a":2}"#]);
        assert_eq!(walk::matches_json(&record, r#"{"a":"x","a":2}"#), Ok(true));
    }

    #[test]
    fn entries_are_matched_in_any_order() {
        let person = person();
        check(
            &person,
            &[
                r#"{"name":"a"}"#,
                r#"{"name":"a","age":1}"#,
                r#"{"age":1,"name":"a"}"#,
            ],
            &[
                "{}",
                r#"{"age":1}"#,
                r#"{"name":"a","age":null}"#,
                r#"{"name":"a","extra":1}"#,
                r#"{"extra":1,"name":"a"}"#,
                "[]",
                "null",
            ],
        );
    }

    #[test]
    fn unknown_keys_of_a_loose_object_are_not_read() {
        let loose = build(|b| {
            let number = b.number();
            b.loose_object([("a", number)])
        });
        check(
            &loose,
            &[
                r#"{"a":1,"b":[1,{"c":null}]}"#,
                r#"{"b":"x","a":1}"#,
                // texts the parser would refuse, at a key that is skipped
                r#"{"a":1,"b":1e400}"#,
                r#"{"a":1,"b":"\ud800"}"#,
            ],
            &[r#"{"b":1}"#, r#"{"a":"1","b":1}"#],
        );
        assert_eq!(
            walk::matches_json(&loose, r#"{"a":1,"b":1e400}"#)
                .unwrap_err()
                .kind(),
            JsonErrorKind::NumberOutOfRange
        );
        // skipped is still parsed for its shape
        assert_eq!(error(&loose, r#"{"a":1,"b":[1,]}"#), JsonErrorKind::Syntax);
        assert_eq!(error(&loose, r#"{"a":1,"b":01}"#), JsonErrorKind::Syntax);
        assert_eq!(
            error(&loose, "{\"a\":1,\"b\":\"\t\"}"),
            JsonErrorKind::Syntax
        );
        // a key is always read
        assert_eq!(
            error(&loose, r#"{"a":1,"\ud800":1}"#),
            JsonErrorKind::LoneSurrogate
        );
    }

    #[test]
    fn what_is_accepted_unread_is_skipped() {
        let schema = build(|b| {
            let unknown = b.unknown();
            let optional = b.optional(unknown);
            b.array(optional)
        });
        check(
            &schema,
            &["[]", r#"[1,"a",null,[],{}]"#, "[1e400]", r#"["\ud800"]"#],
            &["{}", "1"],
        );
        let deep = format!("[{}{}]", "[".repeat(500), "]".repeat(500));
        assert_eq!(matches_json(&schema, &deep), Ok(true));
        assert_eq!(
            walk::matches_json(&schema, &deep).unwrap_err().kind(),
            JsonErrorKind::DepthLimit
        );
    }

    #[test]
    fn nesting_that_is_read_has_a_limit() {
        let schema = build(|b| {
            let lazy = b.declare();
            let array = b.array(lazy);
            b.define(lazy, array);
            lazy
        });
        let nested = |depth: usize| format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        assert_eq!(matches_json(&schema, &nested(127)), Ok(true));
        assert_eq!(error(&schema, &nested(128)), JsonErrorKind::DepthLimit);
    }

    #[test]
    fn a_union_with_one_option_for_a_container_is_matched_as_it_arrives() {
        let schema = build(|b| {
            let string = b.string();
            let number = b.number();
            let null = b.literal(SchemaLiteral::Null);
            let numbers = b.array(number);
            let optional = b.optional(number);
            let named = b.object([("name", string), ("n", optional)]);
            // the one option for an array is a union's, and for an object a
            // wrapper's
            let inner = b.union([null, numbers]);
            let nullable = b.nullable(named);
            let either = b.union([string, inner, nullable]);
            b.array(either)
        });
        check(
            &schema,
            &[
                r#"["x",null,[1,2],{"name":"a"},[],{"n":1,"name":"a"}]"#,
                r#"[{"name":"a","name":"b"}]"#,
            ],
            &[
                "[1]",
                r#"[["x"]]"#,
                "[[[1]]]",
                "[{}]",
                r#"[{"name":"a","other":1}]"#,
                // every occurrence of a key is checked
                r#"[{"name":1,"name":"a"}]"#,
                r#"[{"name":"a","n":"x","n":1}]"#,
                // and the first failure ends the parse
                r#"[[1,"x",}"#,
                r#"[{"name":1,}"#,
                r#"[{"other":1e400}]"#,
                r#"[["x",1e400]]"#,
            ],
        );
        // a tree has the last value of a key, and is read to the end
        for text in [
            r#"[{"name":1,"name":"a"}]"#,
            r#"[{"name":"a","n":"x","n":1}]"#,
        ] {
            assert_eq!(walk::matches_json(&schema, text), Ok(true), "{text}");
        }
        for text in [r#"[[1,"x",}"#, r#"[{"name":1,}"#] {
            assert_eq!(
                walk::matches_json(&schema, text).unwrap_err().kind(),
                JsonErrorKind::Syntax,
                "{text}"
            );
        }
        // what matches is read
        assert_eq!(error(&schema, "[[1,}"), JsonErrorKind::Syntax);
        assert_eq!(error(&schema, "[[1e400]]"), JsonErrorKind::NumberOutOfRange);
        assert_eq!(
            error(&schema, r#"[{"name":"\ud800"}]"#),
            JsonErrorKind::LoneSurrogate
        );
    }

    #[test]
    fn a_union_with_one_option_skips_what_the_option_skips() {
        let schema = build(|b| {
            let string = b.string();
            let number = b.number();
            let loose = b.loose_object([("a", number)]);
            b.union([string, loose])
        });
        check(
            &schema,
            &[
                r#"{"a":1}"#,
                r#"{"a":1,"b":1e400}"#,
                r#"{"b":"\ud800","a":1}"#,
            ],
            &[r#"{"b":1}"#, "[]"],
        );
        assert_eq!(
            walk::matches_json(&schema, r#"{"a":1,"b":1e400}"#)
                .unwrap_err()
                .kind(),
            JsonErrorKind::NumberOutOfRange
        );
    }

    #[test]
    fn a_union_with_no_option_for_a_container_fails_unread() {
        let no_array = build(|b| {
            let string = b.string();
            let number = b.number();
            let object = b.object([("a", number)]);
            let nullable = b.nullable(object);
            b.union([string, number, nullable])
        });
        check(
            &no_array,
            &[r#""x""#, "1", "null", r#"{"a":1}"#],
            &["[]", "[1]", "[", "[1,}", "[1e400]", r#"["\ud800"]"#],
        );
        let no_object = build(|b| {
            let string = b.string();
            let number = b.number();
            let numbers = b.array(number);
            let inner = b.union([number, numbers]);
            b.union([string, inner])
        });
        check(
            &no_object,
            &[r#""x""#, "1", "[1]"],
            &["{}", r#"{"a":1}"#, "{", r#"{"a":}"#, r#"{"a":1e400}"#],
        );
        for (schema, text) in [(&no_array, "[1,}"), (&no_object, r#"{"a":}"#)] {
            assert_eq!(
                walk::matches_json(schema, text).unwrap_err().kind(),
                JsonErrorKind::Syntax
            );
        }
        // a scalar is still a whole token first
        assert_eq!(error(&no_array, r#""x"#), JsonErrorKind::Eof);
    }

    #[test]
    fn a_union_steps_to_a_pipe_of_an_array() {
        let schema = build(|b| {
            let never = b.bigint();
            let number = b.number();
            let numbers = b.array(number);
            let min = b.min_length(1.0);
            let inner = b.pipe([numbers, min]);
            let max = b.max_length(2.0);
            let outer = b.pipe([inner, max]);
            b.union([never, outer])
        });
        check(
            &schema,
            &["[1]", "[1,2]"],
            &["[]", "[1,2,3]", r#"["x"]"#, "{}", "1", "[1,2,3,}"],
        );
    }

    #[test]
    fn a_union_of_a_container_is_read_whole() {
        let schema = build(|b| {
            let string = b.string();
            let number = b.number();
            let strings = b.array(string);
            let numbers = b.array(number);
            let named = b.object([("name", string)]);
            let counted = b.object([("count", number)]);
            let either = b.union([strings, numbers, named, counted, number]);
            b.array(either)
        });
        check(
            &schema,
            &[
                r#"[["a"],[1],{"name":"a"},{"count":1},2]"#,
                "[[],{\"count\":1}]",
                // read whole, so a repeated key is its last value
                r#"[{"name":1,"name":"a"}]"#,
            ],
            &[
                r#"[["a",1]]"#,
                r#"[{"name":"a","count":1}]"#,
                "[{}]",
                r#"["a"]"#,
                // the first item fails, and the second is never read
                r#"[{"name":1},}"#,
            ],
        );
        // read whole, so nothing in it is skipped
        assert_eq!(error(&schema, "[[1,}"), JsonErrorKind::Syntax);
        assert_eq!(error(&schema, "[[1e400]]"), JsonErrorKind::NumberOutOfRange);
    }

    fn shapes() -> Schema {
        build(|b| {
            let circle = b.literal("circle");
            let square = b.literal("square");
            let one = b.literal(1);
            let null = b.literal(SchemaLiteral::Null);
            let number = b.number();
            let optional = b.optional(number);
            let a = b.object([("kind", circle), ("r", number)]);
            let s = b.loose_object([("side", number), ("kind", square)]);
            let n = b.strip_object([("kind", one), ("n", optional)]);
            let z = b.object([("kind", null)]);
            b.variant("kind", [a, s, n, z])
        })
    }

    #[test]
    fn a_variant_dispatches_on_a_first_key() {
        let shapes = shapes();
        check(
            &shapes,
            &[
                r#"{"kind":"circle","r":1}"#,
                r#"{"kind":"square","side":1,"other":[]}"#,
                r#"{"kind":1}"#,
                r#"{"kind":1.0,"n":2,"other":null}"#,
                r#"{"kind":null}"#,
                r#"{"kind":"circle","r":1,"kind":"circle"}"#,
            ],
            &[
                "{}",
                "[]",
                "1",
                r#"{"kind":"circle"}"#,
                r#"{"kind":"circle","r":"1"}"#,
                r#"{"kind":"circle","r":1,"other":1}"#,
                r#"{"kind":"square"}"#,
                r#"{"kind":"triangle","r":1}"#,
                r#"{"kind":"1"}"#,
                r#"{"kind":true}"#,
                r#"{"kind":[],"r":1}"#,
                r#"{"kind":{"kind":"circle"},"r":1}"#,
                r#"{"kind":null,"r":1}"#,
                // ends at the discriminator, whatever follows
                r#"{"kind":"triangle",}"#,
                r#"{"kind":[1,}"#,
            ],
        );
        // a later occurrence is checked against the option the first selected,
        // where the tree evaluator selects by the last
        for text in [
            r#"{"kind":"square","r":1,"kind":"circle"}"#,
            r#"{"kind":"triangle","kind":"circle","r":1}"#,
        ] {
            assert_eq!(matches_json(&shapes, text), Ok(false), "{text}");
            assert_eq!(walk::matches_json(&shapes, text), Ok(true), "{text}");
        }
    }

    #[test]
    fn a_variant_with_a_later_discriminator_is_read_whole() {
        let shapes = shapes();
        check(
            &shapes,
            &[
                r#"{"r":1,"kind":"circle"}"#,
                r#"{"side":1,"other":[],"kind":"square"}"#,
                r#"{"n":2,"kind":1}"#,
                // read whole, so the last discriminator selects
                r#"{"r":1,"kind":"square","kind":"circle"}"#,
            ],
            &[
                r#"{"r":1}"#,
                r#"{"r":"1","kind":"circle"}"#,
                r#"{"r":1,"kind":"circle","other":1}"#,
                r#"{"r":1,"kind":"triangle"}"#,
                r#"{"r":1,"kind":[]}"#,
            ],
        );
        assert_eq!(
            error(&shapes, r#"{"r":1,"kind":"circle",}"#),
            JsonErrorKind::Syntax
        );
        assert_eq!(
            error(&shapes, r#"{"r":1e400,"kind":"circle"}"#),
            JsonErrorKind::NumberOutOfRange
        );
    }

    #[test]
    fn array_pipes_count_as_items_arrive() {
        let schema = build(|b| {
            let number = b.number();
            let array = b.array(number);
            let min = b.min_length(2.0);
            let inner = b.pipe([array, min]);
            let max = b.max_length(3.0);
            let outer = b.pipe([inner, max]);
            b.nullable(outer)
        });
        check(
            &schema,
            &["null", "[1,2]", "[1,2,3]"],
            &[
                "[]",
                "[1]",
                "[1,2,3,4]",
                r#"[1,"2"]"#,
                "{}",
                r#""ab""#,
                // one item too many ends the parse
                "[1,2,3,4,}",
            ],
        );
        let fractional = build(|b| {
            let unknown = b.unknown();
            let array = b.array(unknown);
            let min = b.min_length(0.5);
            let max = b.max_length(1.5);
            b.pipe([array, min, max])
        });
        check(&fractional, &["[null]"], &["[]", "[1,2]"]);
    }

    #[test]
    fn scalar_pipes_reject_containers() {
        let schema = build(|b| {
            let string = b.string();
            let min = b.min_length(1.0);
            b.pipe([string, min])
        });
        check(
            &schema,
            &[r#""a""#],
            &[r#""""#, "[1]", r#"{"length":1}"#, "1"],
        );
        let number = build(|b| {
            let integer = b.integer();
            let min = b.min_value(0.0);
            b.pipe([integer, min])
        });
        check(&number, &["0", "1e2"], &["-1", "0.5", "[]", "{}", r#""1""#]);
    }

    #[test]
    fn many_entries_are_tracked() {
        let keys: Vec<String> = (0..100).map(|i| format!("k{i}")).collect();
        let schema = build(|b| {
            let number = b.number();
            let optional = b.optional(number);
            b.object(
                keys.iter()
                    .enumerate()
                    .map(|(i, key)| (key.as_str(), if i % 2 == 0 { number } else { optional })),
            )
        });
        let text = |skip: usize| {
            let fields: Vec<String> = (0..100)
                .rev()
                .filter(|&i| i != skip)
                .map(|i| format!("\"k{i}\":{i}"))
                .collect();
            format!("{{{}}}", fields.join(","))
        };
        assert_eq!(matches_json(&schema, &text(1000)), Ok(true));
        assert_eq!(matches_json(&schema, &text(99)), Ok(true));
        assert_eq!(matches_json(&schema, &text(98)), Ok(false));
        assert_eq!(matches_json(&schema, &text(0)), Ok(false));
        assert_eq!(walk::matches_json(&schema, &text(98)), Ok(false));
        assert_eq!(walk::matches_json(&schema, &text(99)), Ok(true));
    }

    #[test]
    fn bytes_are_validated_as_utf8_first() {
        let loose = build(|b| b.loose_object::<&str>([]));
        assert_eq!(
            loose.matches_json_bytes("{\"a\":\"é\"}".as_bytes()),
            Ok(true)
        );
        // invalid even where the value would be skipped, or follows a failure
        let skipped = [br#"{"a":""#.as_slice(), &[0xff], br#""}"#].concat();
        let error = loose.matches_json_bytes(&skipped).unwrap_err();
        assert_eq!(error.kind(), JsonErrorKind::InvalidUtf8);
        assert_eq!((error.line(), error.column()), (1, 7));
        let after = [b"[1,".as_slice(), &[0xc3], b"]"].concat();
        assert_eq!(
            loose.matches_json_bytes(&after).unwrap_err().kind(),
            JsonErrorKind::InvalidUtf8
        );
        // a surrogate encoded as UTF-8, and an overlong form
        for bytes in [[0xed, 0xa0, 0x80].as_slice(), &[0xc0, 0x80]] {
            let text = [b"\"".as_slice(), bytes, b"\""].concat();
            assert_eq!(
                loose.matches_json_bytes(&text).unwrap_err().kind(),
                JsonErrorKind::InvalidUtf8
            );
        }
        // a byte order mark is not JSON
        assert_eq!(
            loose
                .matches_json_bytes(b"\xef\xbb\xbf{}")
                .unwrap_err()
                .kind(),
            JsonErrorKind::Syntax
        );
        assert_eq!(loose.matches_json_bytes(b"[]"), Ok(false));
    }
}
