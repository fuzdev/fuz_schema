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
const EVERY_KIND: [(&str, &str, &str); 28] = [
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
    (
        r#"{"kind":"pipe","def":[{"kind":"string"},{"kind":"uuid"}]}"#,
        r#""123e4567-e89b-12d3-a456-426614174000""#,
        r#""123e4567-e89b-12d3-c456-426614174000""#,
    ),
    (
        r#"{"kind":"pipe","def":[{"kind":"string"},{"kind":"iso_datetime"}]}"#,
        r#""2024-02-29T00:00:00.123456789Z""#,
        r#""2023-02-29T00:00:00Z""#,
    ),
    // the step after it reads the lowercase, which of a dotted capital I is two units
    (
        r#"{"kind":"pipe","def":[{"kind":"string"},{"kind":"to_lower_case"},{"kind":"max_length","def":1}]}"#,
        r#""A""#,
        r#""\u0130""#,
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
            format!(r#"{{"schema":{string},"defs":{{"a":{string},"b":{string},"a":{string}}}}}"#),
            "a",
            "/defs/a",
        ),
        (
            format!(r#"{{"schema":{{"kind":"object","def":{{"a/b":{string},"a/b":{string}}}}}}}"#),
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
                r#"{"schema":{"kind":"uuid"}}"#.to_owned(),
                SchemaBuildErrorKind::ActionOutsidePipe { kind: SchemaKind::Uuid },
                "/schema",
            ),
            (
                r#"{"schema":{"kind":"union","def":[{"kind":"string"},{"kind":"iso_datetime"}]}}"#.to_owned(),
                SchemaBuildErrorKind::ActionOutsidePipe { kind: SchemaKind::IsoDatetime },
                "/schema/def/1",
            ),
            (
                r#"{"schema":{"kind":"pipe","def":[{"kind":"number"},{"kind":"uuid"}]}}"#.to_owned(),
                SchemaBuildErrorKind::ActionMismatch { kind: SchemaKind::Uuid },
                "/schema/def/1",
            ),
            (
                r#"{"schema":{"kind":"object","def":{"a":{"kind":"to_lower_case"}}}}"#.to_owned(),
                SchemaBuildErrorKind::ActionOutsidePipe { kind: SchemaKind::ToLowerCase },
                "/schema/def/a",
            ),
            (
                r#"{"schema":{"kind":"pipe","def":[{"kind":"array","def":{"kind":"string"}},{"kind":"to_lower_case"}]}}"#.to_owned(),
                SchemaBuildErrorKind::ActionMismatch { kind: SchemaKind::ToLowerCase },
                "/schema/def/1",
            ),
            (
                r#"{"schema":{"kind":"uuid","def":1}}"#.to_owned(),
                SchemaBuildErrorKind::UnexpectedKey { key: "def".into() },
                "/schema/def",
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
