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
    // whatever the schema, as `number` refuses the infinity it would be read as
    let number = build(SchemaBuilder::number);
    for text in ["1e999", "-1e999", "2e308"] {
        assert_eq!(
            error(&number, text),
            JsonErrorKind::NumberOutOfRange,
            "{text}"
        );
    }
    assert_eq!(matches_json(&number, "1.7976931348623157e308"), Ok(true));
    assert_eq!(
        matches_json(&number, "123456789012345678901234567890"),
        Ok(true)
    );
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
