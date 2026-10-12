//! The crate's JSON tree: a parsed text as JavaScript would hold it.
//!
//! An object keeps its keys in the order `JSON.parse` gives them: a key written
//! twice has its last value at its first position, and keys that are array
//! indices come first, ascending. The tree walker reads this, which is what
//! lets it agree with the TypeScript library exactly.

use std::fmt;
use std::sync::OnceLock;

use serde::de::{DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};

use crate::error::JsonError;
use crate::js;

/// Objects up to this many keys or entries are searched in order, and larger
/// ones through a sorted index.
pub const LINEAR_MAX: usize = 8;

/// The deepest that arrays and objects can be nested in a text the crate
/// reads: one level short of `serde_json`'s recursion limit.
pub const MAX_DEPTH: usize = 127;

/// A JSON value.
#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    /// `null`.
    Null,
    /// `true` or `false`.
    Bool(bool),
    /// A number, as the double `JSON.parse` reads it as.
    Number(f64),
    /// A string.
    String(Box<str>),
    /// An array.
    Array(Box<[Self]>),
    /// An object.
    Object(JsonObject),
}

/// A JSON object, with its keys in JavaScript's order.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct JsonObject {
    entries: Box<[(Box<str>, Json)]>,
    /// The positions in `entries` sorted by key, empty for a small object.
    sorted: Box<[usize]>,
}

/// A value as an evaluator sees it: a borrowed view of a `Json`, or of a
/// scalar the streaming evaluator has in hand, or the `undefined` a missing
/// key reads as.
#[derive(Debug, Clone, Copy)]
pub enum Value<'a> {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(&'a str),
    Array(&'a [Json]),
    Object(&'a JsonObject),
}

impl Json {
    /// Parses `text`.
    ///
    /// # Errors
    ///
    /// When `text` is not JSON, and for what `JSON.parse` reads that this
    /// crate does not: a number too large for a double, a `\u` escape of half a
    /// surrogate pair, and nesting deeper than `MAX_DEPTH`. The error is of
    /// the first problem met.
    ///
    /// Nothing here checks for `serde_json`'s `arbitrary_precision` feature,
    /// under which a number parses to an object. `SchemaBuilder::build` does.
    pub fn parse(text: &str) -> Result<Self, JsonError> {
        let mut deserializer = serde_json::Deserializer::from_str(text);
        let json = JsonSeed
            .deserialize(&mut deserializer)
            .map_err(|error| JsonError::from_serde(&error))?;
        deserializer
            .end()
            .map_err(|error| JsonError::from_serde(&error))?;
        Ok(json)
    }

    pub(crate) fn view(&self) -> Value<'_> {
        match self {
            Self::Null => Value::Null,
            Self::Bool(value) => Value::Bool(*value),
            Self::Number(value) => Value::Number(*value),
            Self::String(value) => Value::String(value),
            Self::Array(items) => Value::Array(items),
            Self::Object(object) => Value::Object(object),
        }
    }
}

impl JsonObject {
    /// Builds an object from entries in the order they were written, as
    /// `JSON.parse` would: the last value of a repeated key at the key's first
    /// position, then array indices first.
    pub(crate) fn from_entries(entries: Vec<(Box<str>, Json)>) -> Self {
        let entries = js::key_order(dedupe(entries)).into_boxed_slice();
        let sorted = if entries.len() > LINEAR_MAX {
            let mut sorted: Vec<usize> = (0..entries.len()).collect();
            sorted.sort_unstable_by(|&a, &b| entries[a].0.cmp(&entries[b].0));
            sorted.into_boxed_slice()
        } else {
            Box::default()
        };
        Self { entries, sorted }
    }

    /// The number of keys.
    pub const fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the object has no keys.
    pub const fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The value at `key`.
    pub fn get(&self, key: &str) -> Option<&Json> {
        let position = if self.sorted.is_empty() {
            self.entries.iter().position(|(k, _)| &**k == key)?
        } else {
            let found = self
                .sorted
                .binary_search_by(|&position| (*self.entries[position].0).cmp(key))
                .ok()?;
            self.sorted[found]
        };
        Some(&self.entries[position].1)
    }

    /// The keys and values, in JavaScript's order.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = (&str, &Json)> {
        self.entries.iter().map(|(key, value)| (&**key, value))
    }
}

impl<K: Into<Box<str>>> FromIterator<(K, Json)> for JsonObject {
    /// An object of the keys and values, held as JavaScript holds one they
    /// were assigned to in that order: a key given twice has its last value at
    /// its first position, and array indices come first.
    fn from_iter<I: IntoIterator<Item = (K, Json)>>(entries: I) -> Self {
        Self::from_entries(
            entries
                .into_iter()
                .map(|(key, value)| (key.into(), value))
                .collect(),
        )
    }
}

impl<K: Into<Box<str>>, const N: usize> From<[(K, Json); N]> for JsonObject {
    /// As `FromIterator`.
    fn from(entries: [(K, Json); N]) -> Self {
        entries.into_iter().collect()
    }
}

/// Whether the parser hands a number over as a number, which both evaluators
/// are written to.
///
/// `serde_json` does not when its `arbitrary_precision` feature is on, which
/// any crate of a build turns on for every crate of it: a number then arrives
/// as a map, and would be matched as an object. Asked once, of the parser
/// itself, and `SchemaBuilder::build` makes no schema when it is not so.
pub fn parser_reads_numbers() -> bool {
    static READS: OnceLock<bool> = OnceLock::new();
    *READS.get_or_init(|| is_one_and_a_half(Json::parse("1.5").ok().as_ref()))
}

/// Whether what `1.5` parsed to is that number.
const fn is_one_and_a_half(parsed: Option<&Json>) -> bool {
    matches!(parsed, Some(Json::Number(number)) if number.to_bits() == 1.5f64.to_bits())
}

/// Keeps one entry per key: the last value given, at the first position.
fn dedupe(entries: Vec<(Box<str>, Json)>) -> Vec<(Box<str>, Json)> {
    if entries.len() < 2 {
        return entries;
    }
    // positions sorted by key, a stable sort so equal keys stay in input order
    let mut order: Vec<usize> = (0..entries.len()).collect();
    order.sort_by(|&a, &b| entries[a].0.cmp(&entries[b].0));
    if order
        .windows(2)
        .all(|pair| entries[pair[0]].0 != entries[pair[1]].0)
    {
        return entries;
    }
    let mut keep = vec![true; entries.len()];
    let mut moves = Vec::new();
    let mut start = 0;
    while start < order.len() {
        let mut end = start + 1;
        while end < order.len() && entries[order[end]].0 == entries[order[start]].0 {
            end += 1;
        }
        if end - start > 1 {
            for &position in &order[start + 1..end] {
                keep[position] = false;
            }
            moves.push((order[end - 1], order[start]));
        }
        start = end;
    }
    let mut slots: Vec<Option<(Box<str>, Json)>> = entries.into_iter().map(Some).collect();
    for (from, to) in moves {
        if let Some((_, value)) = slots[from].take()
            && let Some(first) = slots[to].as_mut()
        {
            first.1 = value;
        }
    }
    slots
        .into_iter()
        .zip(keep)
        .filter_map(|(slot, keep)| slot.filter(|_| keep))
        .collect()
}

/// Deserializes a `Json`. A seed and not a `Deserialize` impl, so the tree's
/// public API names nothing of serde.
pub struct JsonSeed;

impl<'de> DeserializeSeed<'de> for JsonSeed {
    type Value = Json;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Json, D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for JsonSeed {
    type Value = Json;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a JSON value")
    }

    fn visit_unit<E>(self) -> Result<Json, E> {
        Ok(Json::Null)
    }

    fn visit_bool<E>(self, value: bool) -> Result<Json, E> {
        Ok(Json::Bool(value))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Json, E> {
        Ok(Json::Number(number_from_u64(value)))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Json, E> {
        Ok(Json::Number(number_from_i64(value)))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Json, E> {
        Ok(Json::Number(value))
    }

    fn visit_str<E>(self, value: &str) -> Result<Json, E> {
        Ok(Json::String(value.into()))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Json, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element_seed(Self)? {
            items.push(item);
        }
        Ok(Json::Array(items.into_boxed_slice()))
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Json, A::Error> {
        read_object(Vec::new(), map).map(Json::Object)
    }
}

/// Reads the rest of an object after `entries`.
pub fn read_object<'de, A: MapAccess<'de>>(
    mut entries: Vec<(Box<str>, Json)>,
    mut map: A,
) -> Result<JsonObject, A::Error> {
    while let Some(key) = map.next_key::<Box<str>>()? {
        entries.push((key, map.next_value_seed(JsonSeed)?));
    }
    Ok(JsonObject::from_entries(entries))
}

/// The double a non-negative integer token reads as. Rounding to the nearest
/// double is what JavaScript does with the same digits.
#[expect(
    clippy::cast_precision_loss,
    reason = "rounding to the nearest double is the semantics wanted"
)]
pub const fn number_from_u64(value: u64) -> f64 {
    value as f64
}

/// The double a negative integer token reads as.
#[expect(
    clippy::cast_precision_loss,
    reason = "rounding to the nearest double is the semantics wanted"
)]
pub const fn number_from_i64(value: i64) -> f64 {
    value as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::JsonErrorKind;

    fn parse(text: &str) -> Json {
        Json::parse(text).unwrap()
    }

    fn object(text: &str) -> JsonObject {
        match parse(text) {
            Json::Object(object) => object,
            other => panic!("not an object: {other:?}"),
        }
    }

    fn keys(text: &str) -> Vec<String> {
        object(text).iter().map(|(key, _)| key.to_owned()).collect()
    }

    fn number(text: &str) -> f64 {
        match parse(text) {
            Json::Number(number) => number,
            other => panic!("not a number: {other:?}"),
        }
    }

    #[test]
    fn the_parser_reads_a_number_as_a_number() {
        assert!(parser_reads_numbers());
        assert!(is_one_and_a_half(Some(&Json::Number(1.5))));
        // what `1.5` is under `arbitrary_precision`: a map of one key
        let map = JsonObject::from([("$serde_json::private::Number", Json::String("1.5".into()))]);
        for other in [
            Json::Object(map),
            Json::Number(1.0),
            Json::String("1.5".into()),
        ] {
            assert!(!is_one_and_a_half(Some(&other)), "{other:?}");
        }
        assert!(!is_one_and_a_half(None));
    }

    #[test]
    fn an_object_is_built_as_javascript_assigns_one() {
        let object = JsonObject::from([
            ("b", Json::Number(1.0)),
            ("1", Json::Null),
            ("b", Json::Number(2.0)),
        ]);
        assert_eq!(
            object.iter().collect::<Vec<_>>(),
            [("1", &Json::Null), ("b", &Json::Number(2.0))]
        );
        assert_eq!(Json::Object(object), parse(r#"{"b":1,"1":null,"b":2}"#));
        let owned: JsonObject = vec![(String::from("a"), Json::Bool(true))]
            .into_iter()
            .collect();
        assert_eq!(owned.get("a"), Some(&Json::Bool(true)));
    }

    #[test]
    fn scalars() {
        assert_eq!(parse("null"), Json::Null);
        assert_eq!(parse("true"), Json::Bool(true));
        assert_eq!(parse(" \t\n\r1 \t\n\r"), Json::Number(1.0));
        assert_eq!(parse(r#""a\u0000b""#), Json::String("a\0b".into()));
        assert_eq!(parse(r#""\ud83d\ude00""#), Json::String("😀".into()));
        assert_eq!(parse("\"a\u{2028}b\""), Json::String("a\u{2028}b".into()));
    }

    #[test]
    fn numbers_read_as_javascript_reads_them() {
        assert!(number("-0").is_sign_negative());
        assert_eq!(number("-0").to_bits(), (-0.0f64).to_bits());
        assert_eq!(number("1.0").to_bits(), 1.0f64.to_bits());
        assert_eq!(number("1e2").to_bits(), 100.0f64.to_bits());
        assert_eq!(number("1E+2").to_bits(), 100.0f64.to_bits());
        // past 2^53 the nearest double is taken
        assert_eq!(
            number("9007199254740993").to_bits(),
            9_007_199_254_740_992.0f64.to_bits()
        );
        assert_eq!(
            number("18446744073709551615").to_bits(),
            18_446_744_073_709_551_616.0f64.to_bits()
        );
        assert_eq!(
            number("18446744073709551616").to_bits(),
            18_446_744_073_709_551_616.0f64.to_bits()
        );
        assert_eq!(
            number("-9223372036854775809").to_bits(),
            (-9_223_372_036_854_775_808.0f64).to_bits()
        );
        assert_eq!(
            number("123456789012345678901234567890").to_bits(),
            1.234_567_890_123_456_8e29f64.to_bits()
        );
        // underflow is zero, with the sign kept
        assert_eq!(number("1e-400").to_bits(), 0.0f64.to_bits());
        assert_eq!(number("-1e-400").to_bits(), (-0.0f64).to_bits());
        assert_eq!(number("0e99999").to_bits(), 0.0f64.to_bits());
        assert_eq!(number("5e-324").to_bits(), 5e-324f64.to_bits());
        assert_eq!(number("0.1").to_bits(), 0.1f64.to_bits());
        assert_eq!(
            number("0.30000000000000004").to_bits(),
            (0.1f64 + 0.2f64).to_bits()
        );
        assert_eq!(
            number("1.7976931348623157e308").to_bits(),
            f64::MAX.to_bits()
        );
    }

    #[test]
    fn a_repeated_key_keeps_its_last_value_at_its_first_position() {
        assert_eq!(keys(r#"{"a":1,"b":2,"a":3}"#), ["a", "b"]);
        let repeated = object(r#"{"a":1,"b":2,"a":3,"a":4}"#);
        assert_eq!(repeated.len(), 2);
        assert_eq!(repeated.get("a"), Some(&Json::Number(4.0)));
        assert_eq!(repeated.get("b"), Some(&Json::Number(2.0)));
        let index = object(r#"{"b":2,"1":"x","b":3,"1":"y"}"#);
        assert_eq!(
            index.iter().collect::<Vec<_>>(),
            [("1", &Json::String("y".into())), ("b", &Json::Number(3.0))]
        );
    }

    #[test]
    fn keys_are_in_javascript_order() {
        assert_eq!(
            keys(
                r#"{"b":1,"10":1,"2":1,"a":1,"01":1,"4294967294":1,"4294967295":1,"-0":1,"0":1,"":1}"#
            ),
            [
                "0",
                "2",
                "10",
                "4294967294",
                "b",
                "a",
                "01",
                "4294967295",
                "-0",
                ""
            ]
        );
    }

    #[test]
    fn proto_is_an_ordinary_key() {
        let proto = object(r#"{"__proto__":1,"a":2,"__proto__":{"x":1}}"#);
        assert_eq!(
            proto.iter().map(|(key, _)| key).collect::<Vec<_>>(),
            ["__proto__", "a"]
        );
        assert!(matches!(proto.get("__proto__"), Some(Json::Object(_))));
        assert_eq!(proto.get("constructor"), None);
    }

    #[test]
    fn large_objects_are_searched_through_the_index() {
        // every key twice, the second value the one kept
        let fields: Vec<String> = (0..200).map(|i| format!("\"k{}\":{i}", i % 100)).collect();
        let text = format!("{{{}}}", fields.join(","));
        let large = object(&text);
        assert_eq!(large.len(), 100);
        assert!(!large.is_empty());
        for i in 0..100 {
            assert_eq!(
                large.get(&format!("k{i}")),
                Some(&Json::Number(f64::from(i + 100))),
                "k{i}"
            );
        }
        assert_eq!(large.get("k100"), None);
        assert_eq!(large.get(""), None);
        // first positions, in the order first written
        assert_eq!(large.iter().next().map(|(key, _)| key), Some("k0"));
        assert_eq!(large.iter().last().map(|(key, _)| key), Some("k99"));
    }

    #[test]
    fn empty_containers() {
        assert_eq!(parse("[]"), Json::Array(Box::default()));
        let empty = object("{}");
        assert!(empty.is_empty());
        assert_eq!(empty.get("a"), None);
        assert_eq!(parse("{}"), Json::Object(JsonObject::default()));
    }

    #[test]
    fn what_json_parse_rejects_is_rejected() {
        for text in [
            "",
            " ",
            "1 2",
            "[1,]",
            r#"{"a":1,}"#,
            "\u{feff}1",
            "01",
            "-01",
            "00",
            "1.",
            "1.e1",
            ".5",
            "+1",
            "-",
            "1e",
            "1e+",
            "0x10",
            "1_0",
            "NaN",
            "Infinity",
            "nul",
            "True",
            "'a'",
            "\"a\tb\"",
            "\"a\0b\"",
            r#""\x41""#,
            r#""\a""#,
            r#""\u12""#,
            r#"{"a" 1}"#,
            concat!("{", "a:1}"),
            "[1 2]",
            r#"{"a":1}}"#,
            "[",
            "]",
            "\u{a0}1",
            "1\u{a0}",
            "\u{b}1",
            "\u{c}1",
            "\u{2028}1",
        ] {
            let error = Json::parse(text).unwrap_err();
            assert!(
                matches!(error.kind(), JsonErrorKind::Syntax | JsonErrorKind::Eof),
                "{text:?}: {error}"
            );
        }
    }

    #[test]
    fn the_end_of_the_text_is_its_own_kind() {
        for text in ["", " ", "[", "nul", r#""a"#, r#"{"a":"#] {
            assert_eq!(
                Json::parse(text).unwrap_err().kind(),
                JsonErrorKind::Eof,
                "{text:?}"
            );
        }
        let error = Json::parse("[1 2]").unwrap_err();
        assert_eq!(error.kind(), JsonErrorKind::Syntax);
        assert_eq!((error.line(), error.column()), (1, 4));
    }

    #[test]
    fn the_texts_only_javascript_reads() {
        for text in ["1e400", "-1e400", "1e99999", "[1e400]"] {
            assert_eq!(
                Json::parse(text).unwrap_err().kind(),
                JsonErrorKind::NumberOutOfRange,
                "{text}"
            );
        }
        for text in [
            r#""\ud800""#,
            r#""\udc00""#,
            r#""\ud800\u0041""#,
            r#""\ud800\n""#,
            r#"{"\ud800":1}"#,
        ] {
            assert_eq!(
                Json::parse(text).unwrap_err().kind(),
                JsonErrorKind::LoneSurrogate,
                "{text}"
            );
        }
    }

    #[test]
    fn nesting_has_a_limit() {
        let nested = |depth: usize| format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        assert!(Json::parse(&nested(MAX_DEPTH)).is_ok());
        assert_eq!(
            Json::parse(&nested(MAX_DEPTH + 1)).unwrap_err().kind(),
            JsonErrorKind::DepthLimit
        );
        let objects = |depth: usize| format!("{}1{}", r#"{"a":"#.repeat(depth), "}".repeat(depth));
        assert!(Json::parse(&objects(MAX_DEPTH)).is_ok());
        assert_eq!(
            Json::parse(&objects(MAX_DEPTH + 1)).unwrap_err().kind(),
            JsonErrorKind::DepthLimit
        );
    }
}
