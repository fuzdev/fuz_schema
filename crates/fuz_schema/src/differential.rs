//! The streaming evaluator against the tree evaluator, over every schema and
//! every text of a hand-written table.
//!
//! The two must agree, with the exceptions the streaming evaluator declares,
//! which each text here is marked with or is held to have none of.

use crate::builder::SchemaBuilder;
use crate::error::{JsonError, JsonErrorKind};
use crate::json::Json;
use crate::schema::{NodeId, Schema, SchemaLiteral};
use crate::walk::tests::build;
use crate::{stream, walk};

/// What a text allows the streaming verdict to differ by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mark {
    /// Nothing: the same verdict, or an error from both.
    Same,
    /// A key is repeated, so a tree verdict of `true` may be `false`.
    Repeated,
    /// The text is malformed after its first token, so a tree error may be
    /// `false`.
    Tail,
    /// The text holds something the parser refuses that a skip does not see,
    /// so a tree error may be either verdict.
    Refused,
}

fn schemas() -> Vec<(&'static str, Schema)> {
    type Make = fn(&mut SchemaBuilder) -> NodeId;
    let single: [(&str, Make); 28] = [
        ("string", SchemaBuilder::string),
        ("number", SchemaBuilder::number),
        ("boolean", SchemaBuilder::boolean),
        ("bigint", SchemaBuilder::bigint),
        ("unknown", SchemaBuilder::unknown),
        ("integer", SchemaBuilder::integer),
        ("literal", |b| b.literal("a")),
        ("one_of", |b| {
            b.one_of([
                SchemaLiteral::from(1),
                SchemaLiteral::Null,
                SchemaLiteral::from("a"),
            ])
        }),
        ("nullable", |b| {
            let number = b.number();
            b.nullable(number)
        }),
        ("numbers", |b| {
            let number = b.number();
            b.array(number)
        }),
        ("anything", |b| {
            let unknown = b.unknown();
            b.array(unknown)
        }),
        ("nested", |b| {
            let string = b.string();
            let nullable = b.nullable(string);
            let inner = b.array(nullable);
            b.array(inner)
        }),
        ("object", |b| {
            let number = b.number();
            let string = b.string();
            let optional = b.optional(string);
            let default = b.with_default(number, Json::Number(0.0));
            b.object([("a", number), ("b", optional), ("1", default)])
        }),
        ("loose", |b| {
            let number = b.number();
            b.loose_object([("a", number)])
        }),
        ("strip", |b| {
            let number = b.number();
            let unknown = b.unknown();
            b.strip_object([("a", number), ("b", unknown)])
        }),
        ("empty", |b| b.object::<&str>([])),
        ("record", |b| {
            let number = b.number();
            b.record(number)
        }),
        ("records", |b| {
            let number = b.number();
            let numbers = b.array(number);
            b.record(numbers)
        }),
        ("union", |b| {
            let string = b.string();
            let number = b.number();
            let numbers = b.array(number);
            let object = b.object([("a", number)]);
            b.union([string, numbers, object])
        }),
        // no option an array or object could match, then one of each through
        // what is looked through, then two of each
        ("union_of_scalars", |b| {
            let string = b.string();
            let null = b.literal(SchemaLiteral::Null);
            let integer = b.integer();
            b.union([string, null, integer])
        }),
        ("union_looked_through", |b| {
            let number = b.number();
            let string = b.string();
            let numbers = b.array(number);
            let min = b.min_length(1.0);
            let piped = b.pipe([numbers, min]);
            let inner = b.union([string, piped]);
            let optional = b.optional(string);
            let object = b.loose_object([("a", number), ("b", optional)]);
            let lazy = b.declare();
            b.define(lazy, object);
            let nullable = b.nullable(lazy);
            b.union([inner, nullable])
        }),
        ("union_of_two_each", |b| {
            let number = b.number();
            let string = b.string();
            let numbers = b.array(number);
            let strings = b.array(string);
            let first = b.object([("a", number)]);
            let second = b.object([("a", string), ("b", number)]);
            b.union([numbers, first, strings, second])
        }),
        ("union_of_variant", |b| {
            let x = b.literal("x");
            let number = b.number();
            let option = b.object([("a", x), ("b", number)]);
            let variant = b.variant("a", [option]);
            let items = b.array(variant);
            b.union([number, variant, items])
        }),
        ("variant", |b| {
            let x = b.literal("x");
            let one = b.literal(1);
            let number = b.number();
            let first = b.object([("a", x), ("b", number)]);
            let second = b.loose_object([("a", one)]);
            b.variant("a", [first, second])
        }),
        ("string_pipe", |b| {
            let string = b.string();
            let min = b.min_length(1.0);
            let max = b.max_length(2.0);
            b.pipe([string, min, max])
        }),
        ("number_pipe", |b| {
            let number = b.number();
            let integer = b.integer();
            let min = b.min_value(0.0);
            let max = b.max_value(10.0);
            b.pipe([number, integer, min, max])
        }),
        ("array_pipe", |b| {
            let unknown = b.unknown();
            let array = b.array(unknown);
            let min = b.min_length(1.0);
            let max = b.max_length(2.0);
            b.pipe([array, min, max])
        }),
        ("json", |b| {
            let json = b.declare();
            let null = b.literal(SchemaLiteral::Null);
            let boolean = b.boolean();
            let number = b.number();
            let string = b.string();
            let array = b.array(json);
            let record = b.record(json);
            let any = b.union([null, boolean, number, string, array, record]);
            b.define(json, any);
            json
        }),
    ];
    let mut schemas: Vec<(&str, Schema)> = single
        .into_iter()
        .map(|(name, schema)| (name, build(schema)))
        .collect();
    schemas.push((
        "tree",
        build(|b| {
            let tree = b.declare();
            let number = b.number();
            let children = b.array(tree);
            let optional = b.optional(children);
            let node = b.object([("a", number), ("b", optional)]);
            b.define(tree, node);
            tree
        }),
    ));
    schemas
}

const TEXTS: &[(&str, Mark)] = &[
    ("null", Mark::Same),
    ("true", Mark::Same),
    ("false", Mark::Same),
    ("0", Mark::Same),
    ("-0", Mark::Same),
    ("1", Mark::Same),
    ("1.0", Mark::Same),
    ("1e1", Mark::Same),
    ("10", Mark::Same),
    ("11", Mark::Same),
    ("-1", Mark::Same),
    ("1.5", Mark::Same),
    ("9007199254740993", Mark::Same),
    ("18446744073709551616", Mark::Same),
    ("1e-400", Mark::Same),
    (r#""""#, Mark::Same),
    (r#""a""#, Mark::Same),
    (r#""\u0061""#, Mark::Same),
    (r#""ab""#, Mark::Same),
    (r#""abc""#, Mark::Same),
    (r#""😀""#, Mark::Same),
    (r#""\ud83d\ude00""#, Mark::Same),
    (r#""😀a""#, Mark::Same),
    ("[]", Mark::Same),
    ("[1]", Mark::Same),
    ("[1,2]", Mark::Same),
    ("[1,2,3]", Mark::Same),
    ("[null]", Mark::Same),
    (r#"["a",null]"#, Mark::Same),
    (r#"[1,"a"]"#, Mark::Same),
    (r#"["a",1]"#, Mark::Same),
    ("[[]]", Mark::Same),
    ("[[1],[]]", Mark::Same),
    (r#"[["a",null],[]]"#, Mark::Same),
    (r#"[["a"],[1]]"#, Mark::Same),
    ("[{}]", Mark::Same),
    ("{}", Mark::Same),
    (r#"{"a":1}"#, Mark::Same),
    (r#"{"a":"x"}"#, Mark::Same),
    (r#"{"a":"x","b":2}"#, Mark::Same),
    (r#"{"b":2,"a":"x"}"#, Mark::Same),
    (r#"{"a":1,"b":"s"}"#, Mark::Same),
    (r#"{"b":"s","a":1}"#, Mark::Same),
    (r#"{"a":1,"b":null}"#, Mark::Same),
    (r#"{"a":1,"1":2}"#, Mark::Same),
    (r#"{"1":"x","a":1}"#, Mark::Same),
    (r#"{"a":1,"c":3}"#, Mark::Same),
    (r#"{"c":3,"a":1}"#, Mark::Same),
    (r#"{"a":1,"__proto__":3}"#, Mark::Same),
    (r#"{"__proto__":{"a":1}}"#, Mark::Same),
    (r#"{"b":"s"}"#, Mark::Same),
    (r#"{"a":[1,2]}"#, Mark::Same),
    (r#"{"a":[1],"b":[]}"#, Mark::Same),
    (r#"{"a":{"a":1}}"#, Mark::Same),
    (r#"{"a":1,"b":[{"a":2},{"a":3,"b":[]}]}"#, Mark::Same),
    (r#"{"a":1,"b":[{"a":2},{"b":[]}]}"#, Mark::Same),
    (r#"{"b":[],"a":1}"#, Mark::Same),
    (r#"{"":1}"#, Mark::Same),
    (" [ 1 , 2 ] ", Mark::Same),
    // not JSON, wherever it is read
    ("", Mark::Same),
    ("nul", Mark::Same),
    ("1.", Mark::Same),
    ("NaN", Mark::Same),
    ("\u{feff}1", Mark::Same),
    ("\"a\tb\"", Mark::Same),
    (r#""\x""#, Mark::Same),
    // a repeated key
    (r#"{"a":"x","a":1}"#, Mark::Repeated),
    (r#"{"a":1,"a":"x"}"#, Mark::Repeated),
    (r#"{"a":1,"a":2}"#, Mark::Repeated),
    (r#"{"a":"x","b":1,"a":1}"#, Mark::Repeated),
    (r#"{"a":1,"b":2,"a":"x"}"#, Mark::Repeated),
    (r#"{"c":1,"a":1,"c":2}"#, Mark::Repeated),
    (r#"{"a":[1],"a":1}"#, Mark::Repeated),
    (r#"{"a":1,"b":[{"a":"x","a":2}]}"#, Mark::Repeated),
    (r#"[{"a":"x","a":1}]"#, Mark::Repeated),
    // malformed after the first token
    ("01", Mark::Tail),
    ("[", Mark::Tail),
    ("{", Mark::Tail),
    ("[,1]", Mark::Tail),
    (r#"{,"a":1}"#, Mark::Tail),
    (r#"{"a"}"#, Mark::Tail),
    ("{1:1}", Mark::Tail),
    ("1 2", Mark::Tail),
    ("[1,]", Mark::Tail),
    ("[1,2", Mark::Tail),
    (r#"["a",}"#, Mark::Tail),
    (r#"[null,1,"a",}"#, Mark::Tail),
    ("[[1],}", Mark::Tail),
    (r#"{"a":1,}"#, Mark::Tail),
    (r#"{"a":"x",}"#, Mark::Tail),
    (r#"{"a":1,"b""#, Mark::Tail),
    (r#"{"c":1,"a":}"#, Mark::Tail),
    (r#"{"a":1}}"#, Mark::Tail),
    (r#"{"a":[1,"x",}"#, Mark::Tail),
    (r#""a" "b""#, Mark::Tail),
    // what the parser refuses and a skip does not see
    ("1e400", Mark::Refused),
    ("[1e400]", Mark::Refused),
    (r#"[1,"a",1e400]"#, Mark::Refused),
    (r#"{"a":1,"b":1e400}"#, Mark::Refused),
    (r#"{"a":1,"c":-1e400}"#, Mark::Refused),
    (r#""\ud800""#, Mark::Refused),
    (r#"["\udc00"]"#, Mark::Refused),
    (r#"{"a":1,"b":"\ud800"}"#, Mark::Refused),
    (r#"{"a":1,"c":["\ud800\u0041"]}"#, Mark::Refused),
];

fn compare(name: &str, schema: &Schema, text: &str, mark: Mark) {
    let tree = walk::matches_json(schema, text);
    let streamed = stream::matches_json(schema, text);
    let agree = match (&tree, &streamed) {
        (Ok(tree), Ok(streamed)) => {
            // never looser, and stricter only where a key is repeated
            tree == streamed || (mark == Mark::Repeated && *tree && !*streamed)
        }
        (Err(_), Err(_)) => true,
        (Err(_), Ok(false)) => matches!(mark, Mark::Tail | Mark::Refused),
        (Err(_), Ok(true)) => mark == Mark::Refused,
        (Ok(_), Err(_)) => false,
    };
    assert!(
        agree,
        "{name} on {text:?}: tree {tree:?}, stream {streamed:?}"
    );
    // an unmarked text is refused by both for the one reason, when it is: a
    // skip and a parse differ only in where they find a text cut short
    if mark == Mark::Same {
        let kind = |result: &Result<bool, JsonError>| match result.as_ref().map_err(JsonError::kind)
        {
            Err(JsonErrorKind::Eof) => Err(JsonErrorKind::Syntax),
            other => other.copied(),
        };
        assert_eq!(kind(&tree), kind(&streamed), "{name} on {text:?}");
    }
}

#[test]
fn the_evaluators_agree_but_for_what_is_declared() {
    let schemas = schemas();
    for (name, schema) in &schemas {
        for &(text, mark) in TEXTS {
            compare(name, schema, text, mark);
        }
    }
}

#[test]
fn the_evaluators_agree_at_depth() {
    let schemas = schemas();
    for depth in [1, 2, 50, 127] {
        let arrays = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        let objects = format!("{}1{}", r#"{"a":"#.repeat(depth), "}".repeat(depth));
        let records = format!(
            "{}{{}}{}",
            r#"{"b":[{"a":1,"b":["#.repeat(depth / 4),
            "]}]}".repeat(depth / 4)
        );
        for (name, schema) in &schemas {
            for text in [&arrays, &objects, &records] {
                compare(name, schema, text, Mark::Same);
            }
        }
    }
}

#[test]
fn every_mark_is_used_and_every_verdict_reached() {
    for mark in [Mark::Same, Mark::Repeated, Mark::Tail, Mark::Refused] {
        assert!(TEXTS.iter().any(|&(_, m)| m == mark), "{mark:?}");
    }
    // a table of texts no schema matches, or every schema matches, compares
    // nothing
    for (name, schema) in &schemas() {
        let verdicts: Vec<bool> = TEXTS
            .iter()
            .filter_map(|&(text, _)| walk::matches_json(schema, text).ok())
            .collect();
        assert!(
            verdicts.contains(&false) || ["unknown", "json"].contains(name),
            "{name}"
        );
        assert!(verdicts.contains(&true) || *name == "bigint", "{name}");
    }
    // and each declared difference is one the table shows
    let schemas = schemas();
    let differs =
        |mark: Mark, tree: fn(&Result<bool, JsonError>) -> bool, streamed: Result<bool, ()>| {
            schemas.iter().any(|(_, schema)| {
                TEXTS.iter().any(|&(text, m)| {
                    m == mark
                        && tree(&walk::matches_json(schema, text))
                        && stream::matches_json(schema, text).map_err(drop) == streamed
                })
            })
        };
    assert!(differs(Mark::Repeated, |tree| *tree == Ok(true), Ok(false)));
    assert!(differs(Mark::Tail, Result::is_err, Ok(false)));
    assert!(differs(Mark::Refused, Result::is_err, Ok(false)));
    assert!(differs(Mark::Refused, Result::is_err, Ok(true)));
}
