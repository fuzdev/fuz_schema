//! The JavaScript semantics both evaluators share.
//!
//! The TypeScript library validates what `JSON.parse` returns, so a verdict
//! here depends on how JavaScript measures a string, tests a number, and
//! orders the keys of an object. Each of those lives in this module and
//! nowhere else.

/// The largest integer below which every integer is a distinct double,
/// `Number.MAX_SAFE_INTEGER`.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// The largest array index, `2^32 - 2`. A key that is the canonical decimal
/// form of an integer up to this is ordered as a number.
const MAX_ARRAY_INDEX: u32 = u32::MAX - 1;

/// The `length` of `text` as a JavaScript string: its UTF-16 code units.
pub fn utf16_len(text: &str) -> usize {
    // one unit per character, counted by its first byte, and a second unit for
    // the characters outside the basic plane, whose first byte is `0xF0` or more
    text.bytes()
        .map(|byte| usize::from(byte & 0xC0 != 0x80) + usize::from(byte >= 0xF0))
        .sum()
}

/// A length as the number JavaScript compares it as.
#[expect(
    clippy::cast_precision_loss,
    reason = "exact below 2^53, and no input is that long"
)]
pub const fn length_number(length: usize) -> f64 {
    length as f64
}

/// `Number.isInteger`, asked of the value and not of how its token was written:
/// `1.0` and `1e2` are integers.
pub fn is_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0
}

/// `Number.isSafeInteger`.
pub fn is_safe_integer(value: f64) -> bool {
    is_integer(value) && value.abs() <= MAX_SAFE_INTEGER
}

/// `===` between two numbers that are not `NaN`: `-0` equals `0`.
#[expect(
    clippy::float_cmp,
    reason = "a literal matches by JavaScript's `===`, which is exact equality of doubles"
)]
pub const fn number_equals(a: f64, b: f64) -> bool {
    a == b
}

/// The number `key` is ordered by when it is an array index: the canonical
/// decimal form of an integer from `0` to `2^32 - 2`, so `"0"` and `"10"` but
/// not `"01"`, `"1.0"`, `"-0"`, or `"4294967295"`.
pub fn array_index(key: &str) -> Option<u32> {
    let bytes = key.as_bytes();
    // digits only, with no leading zero, and ten are as many as `2^32 - 2` has
    let canonical = matches!(bytes.len(), 1..=10)
        && bytes.iter().all(u8::is_ascii_digit)
        && (bytes[0] != b'0' || bytes.len() == 1);
    if !canonical {
        return None;
    }
    key.parse::<u32>()
        .ok()
        .filter(|&index| index <= MAX_ARRAY_INDEX)
}

/// Orders entries as JavaScript lists an object's own keys: array indices
/// first, ascending, then the rest in the order given.
///
/// The keys must be distinct.
pub fn key_order<T>(entries: Vec<(Box<str>, T)>) -> Vec<(Box<str>, T)> {
    if !entries.iter().any(|(key, _)| array_index(key).is_some()) {
        return entries;
    }
    let mut indexed = Vec::new();
    let mut named = Vec::new();
    for entry in entries {
        match array_index(&entry.0) {
            Some(index) => indexed.push((index, entry)),
            None => named.push(entry),
        }
    }
    indexed.sort_by_key(|&(index, _)| index);
    indexed
        .into_iter()
        .map(|(_, entry)| entry)
        .chain(named)
        .collect()
}

/// The names of the members of `Object.prototype`.
///
/// The TypeScript library reads an object's entries through the prototype, so
/// an entry with one of these names sees the member when the input lacks the
/// key. A schema with such an entry is refused instead of emulating that.
pub const OBJECT_PROTOTYPE_KEYS: [&str; 12] = [
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_len_counts_code_units() {
        assert_eq!(utf16_len(""), 0);
        assert_eq!(utf16_len("abc"), 3);
        // two bytes, one unit
        assert_eq!(utf16_len("é"), 1);
        // three bytes, one unit
        assert_eq!(utf16_len("€"), 1);
        assert_eq!(utf16_len("\u{2028}"), 1);
        // four bytes, two units
        assert_eq!(utf16_len("😀"), 2);
        assert_eq!(utf16_len("a😀é€"), 5);
        assert_eq!(utf16_len("\u{0}"), 1);
        assert_eq!(utf16_len("\u{10FFFF}"), 2);
        assert_eq!(utf16_len("\u{FFFF}"), 1);
        assert_eq!(utf16_len("\u{10000}"), 2);
    }

    #[test]
    fn utf16_len_matches_encode_utf16() {
        for text in [
            "",
            "plain",
            "naïve",
            "日本語",
            "👨‍👩‍👧‍👦",
            "a\u{FFFD}b",
            "\u{1F600}\u{7F}",
        ] {
            assert_eq!(utf16_len(text), text.encode_utf16().count(), "{text:?}");
        }
    }

    #[test]
    fn integer_tests_are_on_the_value() {
        for integer in [
            0.0,
            -0.0,
            1.0,
            1e2,
            4.5e1,
            1e21,
            1e308,
            -9_007_199_254_740_992.0,
        ] {
            assert!(is_integer(integer), "{integer}");
        }
        for other in [1.5, 5e-324, f64::INFINITY, f64::NEG_INFINITY, f64::NAN] {
            assert!(!is_integer(other), "{other}");
        }
        assert!(is_safe_integer(9_007_199_254_740_991.0));
        assert!(is_safe_integer(-9_007_199_254_740_991.0));
        assert!(!is_safe_integer(9_007_199_254_740_992.0));
        assert!(!is_safe_integer(-9_007_199_254_740_992.0));
        assert!(!is_safe_integer(1e21));
        assert!(!is_safe_integer(0.5));
    }

    #[test]
    fn number_equals_is_strict_equality() {
        assert!(number_equals(0.0, -0.0));
        assert!(number_equals(1.0, 1e0));
        assert!(!number_equals(0.1 + 0.2, 0.3));
    }

    #[test]
    fn array_index_is_the_canonical_form() {
        assert_eq!(array_index("0"), Some(0));
        assert_eq!(array_index("10"), Some(10));
        assert_eq!(array_index("4294967294"), Some(4_294_967_294));
        for key in [
            "",
            "01",
            "00",
            "-0",
            "-1",
            "1.0",
            "1e3",
            "+1",
            " 1",
            "4294967295",
            "4294967296",
            "99999999999",
            "a",
            "１",
        ] {
            assert_eq!(array_index(key), None, "{key:?}");
        }
    }

    #[test]
    fn key_order_puts_indices_first() {
        let keys = [
            "b",
            "10",
            "2",
            "a",
            "01",
            "4294967294",
            "4294967295",
            "4294967296",
            "-0",
            "1.0",
            "0",
            "1e3",
            "",
        ];
        let ordered = key_order(keys.iter().map(|&key| (Box::from(key), ())).collect());
        let ordered: Vec<&str> = ordered.iter().map(|(key, ())| &**key).collect();
        // what `Object.keys` gives for an object parsed from these keys in this order
        assert_eq!(
            ordered,
            [
                "0",
                "2",
                "10",
                "4294967294",
                "b",
                "a",
                "01",
                "4294967295",
                "4294967296",
                "-0",
                "1.0",
                "1e3",
                ""
            ]
        );
    }

    #[test]
    fn key_order_keeps_the_order_without_indices() {
        let ordered = key_order(vec![(Box::from("b"), 1), (Box::from("a"), 2)]);
        assert_eq!(ordered, [(Box::from("b"), 1), (Box::from("a"), 2)]);
    }

    #[test]
    fn prototype_keys_are_sorted_and_distinct() {
        assert!(
            OBJECT_PROTOTYPE_KEYS
                .windows(2)
                .all(|pair| pair[0] < pair[1])
        );
    }
}
