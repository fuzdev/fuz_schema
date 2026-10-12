//! The JavaScript semantics both evaluators share.
//!
//! The TypeScript library validates what `JSON.parse` returns, so a verdict
//! here depends on how JavaScript measures a string, tests a number, and
//! orders the keys of an object, and the text of an issue on how it writes a
//! number and quotes a string. Each of those lives in this module and nowhere
//! else.

use std::fmt::Write as _;

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

/// `String(value)`: JavaScript's `Number::toString`, in base ten.
///
/// The digits are the fewest that read back as `value`, see
/// `shortest_digits`. JavaScript writes them plainly when the decimal point
/// falls within twenty-one digits of the first, with up to six zeros before
/// them, and with an exponent otherwise. `-0` is `0`.
pub fn number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    if value.is_infinite() {
        return format!("{sign}Infinity");
    }
    let (digits, exponent) = shortest_digits(value.abs());
    // how many digits come before the decimal point, the specification's `n`
    let point = exponent + 1;
    let zeros = |count: i32| "0".repeat(usize::try_from(count).unwrap_or(0));
    let count = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    if (1..=21).contains(&point) {
        if count <= point {
            return format!("{sign}{digits}{}", zeros(point - count));
        }
        let (whole, fraction) = digits.split_at(usize::try_from(point).unwrap_or(0));
        return format!("{sign}{whole}.{fraction}");
    }
    if (-5..=0).contains(&point) {
        return format!("{sign}0.{}{digits}", zeros(-point));
    }
    let (first, rest) = digits.split_at(1);
    let dot = if rest.is_empty() { "" } else { "." };
    let exponent_sign = if exponent < 0 { '-' } else { '+' };
    format!(
        "{sign}{first}{dot}{rest}e{exponent_sign}{}",
        exponent.unsigned_abs()
    )
}

/// The significant digits `{:e}` writes of `value`, and the exponent of the
/// first of them.
fn scientific_digits(scientific: &str) -> (String, i32) {
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((scientific, "0"));
    let digits = mantissa.chars().filter(char::is_ascii_digit).collect();
    (digits, exponent.parse().unwrap_or(0))
}

/// The most significant digits the decimal expansion of a double has.
const MAX_SIGNIFICANT_DIGITS: usize = 767;

/// The fewest digits that read back as `value`, which is positive and finite,
/// and the exponent of the first of them: the digits JavaScript writes.
///
/// Where more than one run of that many digits reads back, both languages
/// take the one nearest `value`, which is what `{:e}` gives. They differ when
/// two are equally near: JavaScript takes the one whose last digit is even,
/// and `{:e}` the higher.
fn shortest_digits(value: f64) -> (String, i32) {
    let (digits, exponent) = scientific_digits(&format!("{value:e}"));
    let even = |digits: &str| digits.bytes().last().is_some_and(|last| last % 2 == 0);
    if even(&digits) {
        return (digits, exponent);
    }
    // two are equally near when `value` is exactly one more digit, a five.
    // Two more digits rule nearly every double out, and all of them decide
    let count = digits.len();
    let (near, _) = scientific_digits(&format!("{value:.0$e}", count + 1));
    if !near.ends_with("50") {
        return (digits, exponent);
    }
    let (exact, _) = scientific_digits(&format!("{value:.MAX_SIGNIFICANT_DIGITS$e}"));
    let exact = exact.trim_end_matches('0');
    if exact.len() != count + 1 || !exact.ends_with('5') {
        return (digits, exponent);
    }
    // the two are `value` cut short and the next after it, so the other one
    // is a last digit away, and is a possibility at all only when it reads
    // back
    let lower = &exact[..count];
    let other = if lower == digits {
        let (rest, last) = digits.split_at(count - 1);
        match last.parse::<u8>() {
            Ok(last) if last < 9 => format!("{rest}{}", last + 1),
            _ => return (digits, exponent),
        }
    } else {
        lower.to_owned()
    };
    let reads_back = format!("0.{other}e{}", exponent + 1)
        .parse::<f64>()
        .is_ok_and(|read| read.to_bits() == value.to_bits());
    if even(&other) && reads_back {
        (other, exponent)
    } else {
        (digits, exponent)
    }
}

/// `JSON.stringify(text)`: the string in double quotes, with the quote, the
/// backslash, and the control characters below U+0020 escaped, the ones that
/// have a short escape with it and the others as four lowercase hex digits.
/// Nothing else is escaped, `/`, U+007F, and U+2028 included.
pub fn quote(text: &str) -> String {
    let mut quoted = String::with_capacity(text.len() + 2);
    quoted.push('"');
    for character in text.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\u{8}' => quoted.push_str("\\b"),
            '\u{c}' => quoted.push_str("\\f"),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            control if control < ' ' => {
                // writing to a `String` does not fail
                let _ = write!(quoted, "\\u{:04x}", u32::from(control));
            }
            other => quoted.push(other),
        }
    }
    quoted.push('"');
    quoted
}

/// The names of the members of `Object.prototype`.
///
/// The TypeScript library reads an object's entries through the prototype, so
/// an entry with one of these names sees the member when the input lacks the
/// key, and so does a `variant` whose key is one. A schema with such an entry
/// or key is refused instead of emulating that.
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

    /// Doubles by their bits, each with what JavaScript's `String` gives.
    #[test]
    fn number_to_string_is_javascripts() {
        let cases: &[(u64, &str)] = &[
            (0x3ff0_0000_0000_0000, "1"),
            (0xbff0_0000_0000_0000, "-1"),
            (0x3ff8_0000_0000_0000, "1.5"),
            (0xbff8_0000_0000_0000, "-1.5"),
            (0x3fb9_9999_9999_999a, "0.1"),
            (0x3fd3_3333_3333_3334, "0.30000000000000004"),
            (0x405e_dd2f_1a9f_be77, "123.456"),
            (0x4059_0000_0000_0000, "100"),
            (0x4415_af1d_78b5_8c40, "100000000000000000000"),
            (0x444b_1ae4_d6e2_ef50, "1e+21"),
            (0x4480_f0cf_064d_d592, "1e+22"),
            (0xc44b_1ae4_d6e2_ef50, "-1e+21"),
            (0x444b_1ae4_d6e2_ef4f, "999999999999999900000"),
            (0x441a_c53a_7e04_bcda, "123456789012345680000"),
            (0x4450_bb44_8ec2_f608, "1.2345678901234568e+21"),
            (0x3eb0_c6f7_a0b5_ed8d, "0.000001"),
            (0x3e7a_d7f2_9abc_af48, "1e-7"),
            (0x3eb9_2a73_7110_e454, "0.0000015"),
            (0x3e84_21f5_f40d_8376, "1.5e-7"),
            (0x3eb4_b3fd_5942_cd96, "0.000001234"),
            (0x3e80_8ffd_e102_3e12, "1.234e-7"),
            (0x3ee4_f8b5_88e3_68f1, "0.00001"),
            (0x3fe0_0000_0000_0000, "0.5"),
            (0x0000_0000_0000_0001, "5e-324"),
            (0x8000_0000_0000_0001, "-5e-324"),
            (0x0010_0000_0000_0000, "2.2250738585072014e-308"),
            (0x7fef_ffff_ffff_ffff, "1.7976931348623157e+308"),
            (0xffef_ffff_ffff_ffff, "-1.7976931348623157e+308"),
            (0x7e37_e43c_8800_759c, "1e+300"),
            (0x7e3c_ab7b_d666_f388, "1.2e+300"),
            (0x54b2_49ad_2594_c37d, "1e+100"),
            (0x4340_0000_0000_0000, "9007199254740992"),
            (0x433f_ffff_ffff_ffff, "9007199254740991"),
            (0xc340_0000_0000_0000, "-9007199254740992"),
            (0x4340_0000_0000_0001, "9007199254740994"),
            (0x41ef_ffff_ffe0_0000, "4294967295"),
            (0x41f0_0000_0000_0000, "4294967296"),
            (0x3fe9_9999_9999_9999, "0.7999999999999999"),
            (0x3fd5_5555_5555_5555, "0.3333333333333333"),
            (0x3fe5_5555_5555_5555, "0.6666666666666666"),
            (0x4059_2000_0000_0000, "100.5"),
            (0x430c_6bf5_2634_0004, "1000000000000000.5"),
            (0x419d_6f34_547e_6b74, "123456789.12345678"),
            (0x3eaf_e070_17c0_1026, "9.5e-7"),
            (0x3ff0_0000_0000_0001, "1.0000000000000002"),
            (0x3fd3_3333_3333_3333, "0.3"),
            (0x4039_0000_0000_0000, "25"),
            (0x4024_0000_0000_0000, "10"),
            (0x4450_4356_1a88_2930, "1.2e+21"),
            (0x4454_542b_a12a_337c, "1.5e+21"),
            (0x4011_6666_6666_6666, "4.35"),
            (0x3f02_599e_d7c6_fbd2, "0.000035"),
            (0x3ea0_c6f7_a0b5_ed8d, "5e-7"),
            (0x44b5_2d02_c7e1_4af6, "1e+23"),
            (0x4370_0000_0000_0000, "72057594037927940"),
            (0x3eb2_7476_ca61_b882, "0.0000011"),
            (0x43e5_6a95_319d_63e1, "12345678901234567000"),
            (0x3ddb_7cdf_d9d7_bdbf, "1.0000000000000006e-10"),
            (0x3eff_7510_4d55_1d69, "0.00003"),
            (0x4430_0000_0000_0000, "295147905179352830000"),
            (0x4440_0000_0000_0000, "590295810358705700000"),
            (0x4450_0000_0000_0000, "1.1805916207174113e+21"),
        ];
        for &(bits, text) in cases {
            let value = f64::from_bits(bits);
            assert_eq!(number_to_string(value), text, "{bits:#x}");
            // and it reads back as the double it was written from
            assert_eq!(text.parse::<f64>().ok().map(f64::to_bits), Some(bits));
        }
    }

    /// Doubles that are exactly halfway between the two shortest runs of
    /// digits that read back as them, where JavaScript takes the even one:
    /// some the lower of the two, some the higher.
    #[test]
    fn number_to_string_breaks_a_tie_to_the_even_digit() {
        let cases: &[(u64, &str)] = &[
            (0x4085_fa3f_a000_0000, "703.2810668945312"),
            (0x4033_099d_0000_0000, "19.037551879882812"),
            (0x4052_235a_8000_0000, "72.55239868164062"),
            (0x408c_ef7f_a000_0000, "925.9373168945312"),
            (0x408d_4468_6000_0000, "936.5509643554688"),
            (0x4085_d0e5_e000_0000, "698.1122436523438"),
            (0x4089_13ab_e000_0000, "802.4589233398438"),
            (0x40f7_72ff_3300_0000, "96047.94995117188"),
            (0x403e_5d51_0000_0000, "30.364517211914062"),
            (0x410f_bc8d_d380_0000, "259985.72827148438"),
            (0x4082_aeb9_6000_0000, "597.8405151367188"),
            (0x4086_9c85_a000_0000, "723.5652465820312"),
            (0x408e_8dde_a000_0000, "977.7337036132812"),
            (0x40fa_2d84_6100_0000, "107224.27368164062"),
            (0x40d9_fc68_4a00_0000, "26609.629516601562"),
            (0x4065_7fe8_4000_0000, "171.99710083007812"),
        ];
        let mut lower = 0;
        for &(bits, text) in cases {
            let value = f64::from_bits(bits);
            assert_eq!(number_to_string(value), text, "{bits:#x}");
            assert_eq!(number_to_string(-value), format!("-{text}"), "{bits:#x}");
            assert_eq!(text.parse::<f64>().ok().map(f64::to_bits), Some(bits));
            // what `{}` writes is the other of the two when it is the odd one
            lower += usize::from(value.to_string() != text);
        }
        assert!(lower > 0 && lower < cases.len(), "{lower}");
        assert_eq!(number_to_string(f64::from(232.1_f32)), "232.10000610351562");
        // a five that is not the last digit is no tie
        assert_eq!(number_to_string(0.5), "0.5");
        assert_eq!(number_to_string(1.25), "1.25");
        assert_eq!(number_to_string(2.5e-5), "0.000025");
    }

    #[test]
    fn number_to_string_has_no_negative_zero() {
        assert_eq!(number_to_string(0.0), "0");
        assert_eq!(number_to_string(-0.0), "0");
        assert_eq!(number_to_string(f64::NAN), "NaN");
        assert_eq!(number_to_string(f64::INFINITY), "Infinity");
        assert_eq!(number_to_string(f64::NEG_INFINITY), "-Infinity");
    }

    /// Where the plain form gives way to the exponent, on both sides.
    #[test]
    fn number_to_string_turns_to_an_exponent_at_the_thresholds() {
        for (value, text) in [
            (1e20, "100000000000000000000"),
            (123_456_789_012_345_680_000.0, "123456789012345680000"),
            (999_999_999_999_999_900_000.0, "999999999999999900000"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (-1e21, "-1e+21"),
            (1e-6, "0.000001"),
            (1.5e-6, "0.0000015"),
            (9.5e-7, "9.5e-7"),
            (1e-7, "1e-7"),
            (-1.234e-7, "-1.234e-7"),
            (0.5, "0.5"),
            (1.0, "1"),
            (10.0, "10"),
            (12.5, "12.5"),
            (4_294_967_296.0, "4294967296"),
        ] {
            assert_eq!(number_to_string(value), text);
        }
    }

    /// Every power of ten a double reaches, by the form JavaScript writes it in.
    #[test]
    fn number_to_string_writes_every_power_of_ten() {
        for exponent in -323..=308 {
            let value: f64 = format!("1e{exponent}").parse().unwrap();
            let expected = match exponent {
                0..=20 => format!("1{}", "0".repeat(usize::try_from(exponent).unwrap())),
                -6..=-1 => format!("0.{}1", "0".repeat(usize::try_from(-exponent - 1).unwrap())),
                _ if exponent > 0 => format!("1e+{exponent}"),
                _ => format!("1e{exponent}"),
            };
            assert_eq!(number_to_string(value), expected);
            assert_eq!(number_to_string(-value), format!("-{expected}"));
        }
    }

    #[test]
    fn quote_escapes_as_json_stringify_does() {
        // the escape of a control character with no short form
        const U: &str = "\\u";
        assert_eq!(quote(""), r#""""#);
        assert_eq!(quote("a b"), r#""a b""#);
        assert_eq!(quote(r#"a"b"#), r#""a\"b""#);
        assert_eq!(quote(r"a\b"), r#""a\\b""#);
        assert_eq!(quote(r#"\""#), r#""\\\"""#);
        assert_eq!(quote("\u{8}\u{c}\n\r\t"), r#""\b\f\n\r\t""#);
        assert_eq!(quote("\u{0}"), format!("\"{U}0000\""));
        assert_eq!(quote("\u{1}"), format!("\"{U}0001\""));
        assert_eq!(quote("\u{b}"), format!("\"{U}000b\""));
        assert_eq!(quote("\u{1b}"), format!("\"{U}001b\""));
        assert_eq!(quote("\u{1f}"), format!("\"{U}001f\""));
        // nothing from the space up is escaped
        for plain in [
            " ",
            "/",
            "'",
            "<",
            "\u{7f}",
            "\u{80}",
            "\u{9f}",
            "\u{a0}",
            "é",
            "\u{2028}",
            "\u{2029}",
            "\u{feff}",
            "\u{ffff}",
            "😀",
            "\u{10ffff}",
        ] {
            assert_eq!(quote(plain), format!("\"{plain}\""), "{plain:?}");
        }
        // every control character is escaped, and reads back as itself
        for code in 0..0x20u8 {
            let text = char::from(code).to_string();
            let quoted = quote(&text);
            assert!(quoted.is_ascii() && quoted.len() >= 4, "{code}");
            assert!(!quoted.chars().any(char::is_control), "{code}");
            assert_eq!(quoted.to_lowercase(), quoted, "{code}");
            assert_eq!(
                serde_json::from_str::<String>(&quoted).ok(),
                Some(text),
                "{code}"
            );
        }
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
