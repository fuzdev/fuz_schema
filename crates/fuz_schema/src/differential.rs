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
    let single: [(&str, Make); 36] = [
        ("string", SchemaBuilder::string),
        ("number", SchemaBuilder::number),
        ("boolean", SchemaBuilder::boolean),
        ("bigint", SchemaBuilder::bigint),
        ("unknown", SchemaBuilder::unknown),
        ("integer", SchemaBuilder::integer),
        ("safe_integer", SchemaBuilder::safe_integer),
        ("uuid", |b| {
            let string = b.string();
            let uuid = b.uuid();
            b.pipe([string, uuid])
        }),
        ("datetime", |b| {
            let string = b.string();
            let datetime = b.iso_datetime();
            let lower = b.to_lower_case();
            let piped = b.pipe([string, datetime, lower]);
            b.nullable(piped)
        }),
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
        ("lowercase", |b| {
            let string = b.string();
            let lower = b.to_lower_case();
            let max = b.max_length(1.0);
            let piped = b.pipe([string, lower, max]);
            b.nullable(piped)
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
        // a variant among options that could take an object too, so the
        // object is read whole before the variant sees its discriminator
        ("union_of_variant_and_object", |b| {
            let x = b.literal("x");
            let number = b.number();
            let option = b.object([("a", x), ("b", number)]);
            let variant = b.variant("a", [option]);
            let loose = b.loose_object([("b", number)]);
            let items = b.array(variant);
            b.union([variant, loose, items])
        }),
        // more entries than are searched in order
        ("wide", |b| {
            let number = b.number();
            let optional = b.optional(number);
            let mut entries = vec![("a", number)];
            for key in ["b", "c", "1", "k0", "k1", "k2", "k3", "k4", "k5"] {
                entries.push((key, optional));
            }
            b.object(entries)
        }),
        ("wide_loose", |b| {
            let string = b.string();
            let optional = b.optional(string);
            let unknown = b.unknown();
            let mut entries = vec![("c", unknown)];
            for key in ["a", "b", "0", "k0", "k1", "k2", "k3", "k4", "k5"] {
                entries.push((key, optional));
            }
            b.loose_object(entries)
        }),
        // a union two of whose options could take an array, and two an
        // object, each reaching its cycle, so it keeps its verdicts on both
        ("memoized", |b| {
            let lazy = b.declare();
            let items = b.array(lazy);
            let short = b.max_length(1.0);
            let short_items = b.pipe([items, short]);
            let other_items = b.array(lazy);
            let a = b.loose_object([("a", lazy)]);
            let record = b.record(lazy);
            let union = b.union([short_items, other_items, a, record]);
            b.define(lazy, union);
            lazy
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
    (r#""A""#, Mark::Same),
    (r#""\u0130""#, Mark::Same),
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
    // integers at the edge of the safe ones
    ("9007199254740991", Mark::Same),
    ("-9007199254740991.0", Mark::Same),
    ("9007199254740992", Mark::Same),
    // the format tests
    (r#""123e4567-e89b-42d3-a456-426614174000""#, Mark::Same),
    (r#""123E4567-E89B-42D3-A456-426614174000""#, Mark::Same),
    (r#""\u003123e4567-e89b-42d3-a456-426614174000""#, Mark::Same),
    (r#""00000000-0000-0000-0000-000000000000""#, Mark::Same),
    (r#""123e4567-e89b-02d3-a456-426614174000""#, Mark::Same),
    (r#""2024-02-29T12:00:00Z""#, Mark::Same),
    (r#""2024-01-01T00:00:00.123456789Z""#, Mark::Same),
    (r#""2023-02-29T12:00:00Z""#, Mark::Same),
    (r#""2024-01-01t00:00:00z""#, Mark::Same),
    (r#"["2024-01-01T00:00:00Z",null]"#, Mark::Same),
    // more keys than are searched in order, in the schema's order and not
    (
        r#"{"a":1,"b":2,"c":3,"1":4,"k0":5,"k1":6,"k2":7,"k3":8,"k4":9,"k5":10}"#,
        Mark::Same,
    ),
    (
        r#"{"k5":"x","k4":"x","k3":"x","k2":"x","k1":"x","k0":"x","0":"x","b":"x","a":"x","c":1}"#,
        Mark::Same,
    ),
    (
        r#"{"k0":1,"k1":2,"k2":3,"k3":4,"k4":5,"k5":6,"b":7,"c":8,"a":9,"z":10}"#,
        Mark::Same,
    ),
    (r#"{"k5":"x","a":1,"k9":1,"c":null}"#, Mark::Same),
    // keys written with escapes, which are the keys they spell
    (r#"{"\u0061":1}"#, Mark::Same),
    (r#"{"\u0062":"s","a":1}"#, Mark::Same),
    (r#"{"\"":1,"a":1}"#, Mark::Same),
    (r#"{"a\u0000":1,"a":1}"#, Mark::Same),
    // a variant's discriminator after the other keys, in and out of an array
    (r#"[{"b":2,"a":"x"}]"#, Mark::Same),
    (r#"[{"b":2,"a":"y"}]"#, Mark::Same),
    (r#"{"b":"2","a":"x"}"#, Mark::Same),
    // values a union that keeps its verdicts is asked of more than once
    ("[[[]]]", Mark::Same),
    ("[[],[]]", Mark::Same),
    ("[[[],[]]]", Mark::Same),
    (r#"{"a":{"a":[1]}}"#, Mark::Same),
    (r#"[{"a":[[]]},{"b":{}}]"#, Mark::Same),
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
    (r#"{"\u0061":"x","a":1}"#, Mark::Repeated),
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
    // a lone surrogate in a key, which a skip reads no more than a value
    (r#"{"\ud800":1}"#, Mark::Refused),
    (r#"{"a":1,"\udc00x":2}"#, Mark::Refused),
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

/// The schemas that are in the table for a path of the evaluators take it: a
/// union that keeps its verdicts on arrays and on objects, and objects of
/// more entries than are searched in order.
#[test]
fn the_schemas_take_the_paths_they_are_here_for() {
    use crate::json::LINEAR_MAX;
    use crate::schema::{Container, SchemaNode};
    let schemas = schemas();
    let schema = |name: &str| &schemas.iter().find(|(n, _)| *n == name).unwrap().1;
    let memoized = schema("memoized");
    let SchemaNode::Lazy(union) = memoized.at(memoized.root()) else {
        panic!("not a lazy");
    };
    for container in [Container::Array, Container::Object] {
        assert!(memoized.memoizes_on(*union, container), "{container:?}");
    }
    for name in ["wide", "wide_loose"] {
        let wide = schema(name);
        let entries = wide.at(wide.root()).entries().unwrap();
        assert!(entries.len() > LINEAR_MAX, "{name}");
    }
}

/// A text of over a hundred kilobytes, generated here from a fixed seed: an
/// array of records, each with a recursive value, once as it is made and once
/// with one value changed near the start, the middle, or the end. The two
/// evaluators give one verdict on each, and `validate_json` has issues exactly
/// when the tree evaluator says no. Nothing either evaluator does turns on the
/// size of a text, as both read it whole from one string, so a larger one
/// takes no path this one doesn't.
#[test]
fn the_evaluators_agree_on_a_large_text() {
    let schema = build(|b| {
        let json = b.declare();
        let null = b.literal(SchemaLiteral::Null);
        let boolean = b.boolean();
        let number = b.number();
        let string = b.string();
        let items = b.array(json);
        let fields = b.record(json);
        let any = b.union([null, boolean, number, string, items, fields]);
        b.define(json, any);
        let integer = b.integer();
        let id = b.pipe([number, integer]);
        let short = b.max_length(8.0);
        let name = b.pipe([string, short]);
        let tag = b.one_of([
            SchemaLiteral::from("a"),
            SchemaLiteral::from("b"),
            SchemaLiteral::from("c"),
        ]);
        let tags = b.array(tag);
        let data = b.optional(json);
        let item = b.object([("id", id), ("name", name), ("tags", tags), ("data", data)]);
        b.array(item)
    });
    // a linear congruential generator, enough to vary the text
    let mut state: u64 = 0x2545_f491_4f6c_dd1d;
    let mut next = move |below: u64| {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (state >> 33) % below
    };
    let mut items = Vec::new();
    let mut length = 0;
    while length < 1 << 17 {
        let tags: Vec<&str> = (0..next(4))
            .map(|_| ["\"a\"", "\"b\"", "\"c\""][usize::try_from(next(3)).unwrap()])
            .collect();
        let data = match next(4) {
            0 => String::new(),
            1 => r#","data":null"#.to_owned(),
            2 => format!(r#","data":{{"x":[{},"é",true,{{"y":[]}}]}}"#, next(1000)),
            _ => format!(r#","data":[[{}],{{"z":"😀"}}]"#, next(1000)),
        };
        let item = format!(
            r#"{{"id":{},"name":"n{}","tags":[{}]{data}}}"#,
            items.len(),
            next(1000),
            tags.join(",")
        );
        length += item.len() + 1;
        items.push(item);
    }
    let whole = format!("[{}]", items.join(","));
    assert!(whole.len() > 1 << 17);
    let mut texts = vec![whole];
    for at in [3, items.len() / 2, items.len() - 2] {
        for wrong in [
            format!(r#"{{"id":{at}.5,"name":"n","tags":[]}}"#),
            format!(r#"{{"id":{at},"name":"too long a name","tags":[]}}"#),
            format!(r#"{{"id":{at},"name":"n","tags":["d"]}}"#),
            format!(r#"{{"id":{at},"name":"n","tags":[],"other":1}}"#),
        ] {
            let mut changed = items.clone();
            changed[at] = wrong;
            texts.push(format!("[{}]", changed.join(",")));
        }
    }
    for (index, text) in texts.iter().enumerate() {
        let tree = walk::matches_json(&schema, text);
        let streamed = stream::matches_json(&schema, text);
        let issues = walk::validate_json(&schema, text).unwrap();
        // the first is whole, and every other has one value wrong
        assert_eq!(tree, Ok(index == 0), "text {index}");
        assert_eq!(streamed, tree, "text {index}");
        assert_eq!(
            issues.len(),
            usize::from(index != 0),
            "text {index}: {issues:?}"
        );
    }
}
