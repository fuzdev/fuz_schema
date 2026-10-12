//! The tree evaluator: the TypeScript library's `run` functions, over a value
//! held as JavaScript would hold it.
//!
//! This is the reference. Given the tree `Json::parse` builds, it reaches the
//! verdict the TypeScript library reaches on what `JSON.parse` returns. The
//! streaming evaluator hands it every scalar, so the two share one reading of
//! each kind.
//!
//! Failures go to a `Report`. `Probe` only wants the verdict, and evaluation
//! returns at the first failure. A report that collects goes on, and is told
//! where each failure is.

use crate::error::JsonError;
use crate::js;
use crate::json::{Json, Value};
use crate::schema::{Entries, MAX_NESTING, Node, NodeId, Schema, VariantDef};

/// Where failures go.
pub trait Report {
    /// Whether only the verdict is wanted, so evaluation stops at the first
    /// failure.
    const PROBE: bool;

    /// A value failed `node`, or was a key `node` does not have.
    fn fail(&mut self, node: NodeId, failure: Failure, received: Received);

    /// What follows is about the value at `segment` of the current one.
    fn enter(&mut self, segment: Segment<'_>);

    /// Ends the last `enter`.
    fn leave(&mut self);
}

/// What failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// The value did not match the node.
    Schema,
    /// The value is at a key the `object` node has no entry for.
    UnknownKey,
}

/// A step from a container to a value in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Segment<'a> {
    Key(&'a str),
    Index(usize),
}

/// The type of a value that failed, as the TypeScript library names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Received {
    Undefined,
    Null,
    Boolean,
    Number,
    String,
    Array,
    Object,
}

impl Received {
    const fn of(value: Value<'_>) -> Self {
        match value {
            Value::Undefined => Self::Undefined,
            Value::Null => Self::Null,
            Value::Bool(_) => Self::Boolean,
            Value::Number(_) => Self::Number,
            Value::String(_) => Self::String,
            Value::Array(_) => Self::Array,
            Value::Object(_) => Self::Object,
        }
    }
}

/// The report that only wants the verdict.
#[derive(Debug)]
pub struct Probe;

impl Report for Probe {
    const PROBE: bool = true;

    fn fail(&mut self, _: NodeId, _: Failure, _: Received) {}

    fn enter(&mut self, _: Segment<'_>) {}

    fn leave(&mut self) {}
}

/// Whether `text` is JSON that matches `schema`, by parsing all of it into a
/// tree and walking the tree.
pub fn is_json(schema: &Schema, text: &str) -> Result<bool, JsonError> {
    let json = Json::parse(text)?;
    Ok(run(schema, schema.root(), json.view(), &mut Probe))
}

/// Whether `value` matches the node `id`, reporting what does not.
///
/// Recurses once per level of the value, and along a schema's nesting, which
/// `SchemaBuilder::build` has bounded. The frames of the second recursion are
/// this function's and `union`'s, so this one holds only the kinds that step
/// to another node for the same value, and `rest` holds the others. A `pipe`
/// that starts with a `pipe` is not a recursion: `pipe` follows them down.
pub fn run<R: Report>(schema: &Schema, mut id: NodeId, value: Value<'_>, report: &mut R) -> bool {
    loop {
        match schema.at(id) {
            Node::Optional(inner) => {
                if matches!(value, Value::Undefined) {
                    return true;
                }
                id = *inner;
            }
            Node::Nullable(inner) => {
                if matches!(value, Value::Null) {
                    return true;
                }
                id = *inner;
            }
            Node::Default(default) => {
                if matches!(value, Value::Undefined) {
                    return true;
                }
                id = default.schema();
            }
            Node::Lazy(inner) => id = *inner,
            Node::Union(options) => {
                if union(schema, options, value) {
                    return true;
                }
                report.fail(id, Failure::Schema, Received::of(value));
                return false;
            }
            _ => match rest(schema, id, value, report) {
                Rest::Matched(matched) => return matched,
                Rest::Option(option) => id = option,
            },
        }
    }
}

/// What `rest` found: a verdict, or the option of a `variant` to go on with.
enum Rest {
    Matched(bool),
    Option(NodeId),
}

/// The kinds `run` does not step through itself.
fn rest<R: Report>(schema: &Schema, id: NodeId, value: Value<'_>, report: &mut R) -> Rest {
    let node = schema.at(id);
    let matched = match node {
        Node::Object(entries) => object(schema, id, entries, true, value, report),
        Node::LooseObject(entries) | Node::StripObject(entries) => {
            object(schema, id, entries, false, value, report)
        }
        Node::Record(inner) => record(schema, id, *inner, value, report),
        Node::Array(inner) => array(schema, id, *inner, value, report),
        // each step reports its own failure, and the first one ends the pipe
        Node::Pipe(steps) => pipe(schema, steps, value, report),
        Node::Variant(variant) => match select(variant, value) {
            Selected::Option(option) => return Rest::Option(option),
            Selected::NotObject => fail(id, value, report),
            Selected::Unknown(discriminator) => {
                report.enter(Segment::Key(variant.key()));
                report.fail(id, Failure::Schema, Received::of(discriminator));
                report.leave();
                false
            }
        },
        _ => scalar(node, value) || fail(id, value, report),
    };
    Rest::Matched(matched)
}

/// Reports that `value` does not match the node `id`.
fn fail<R: Report>(id: NodeId, value: Value<'_>, report: &mut R) -> bool {
    report.fail(id, Failure::Schema, Received::of(value));
    false
}

/// Whether any option matches. Options are only probed: a union that fails
/// reports itself and not what its options found.
fn union(schema: &Schema, options: &[NodeId], value: Value<'_>) -> bool {
    for &option in options {
        if run(schema, option, value, &mut Probe) {
            return true;
        }
    }
    false
}

/// The steps of a pipe in order, each reporting its own failure, the first of
/// which ends it.
///
/// A pipe can start with a pipe. Those are followed down to the schema they
/// all start with, keeping each one's actions, so that however many there are
/// they cost the frames of one.
fn pipe<'a, R: Report>(
    schema: &'a Schema,
    mut steps: &'a [NodeId],
    value: Value<'_>,
    report: &mut R,
) -> bool {
    // the actions of each pipe, from the outermost in
    let mut pipes: [&[NodeId]; MAX_NESTING + 1] = [&[]; MAX_NESTING + 1];
    let mut count = 0;
    while let Some((&head, actions)) = steps.split_first() {
        // `build` lets no more pipes than this start with one another
        let Some(pipe) = pipes.get_mut(count) else {
            return false;
        };
        *pipe = actions;
        count += 1;
        if let Node::Pipe(inner) = schema.at(head) {
            steps = inner;
        } else {
            if !run(schema, head, value, report) {
                return false;
            }
            break;
        }
    }
    // the innermost pipe's actions are the first to follow the schema
    for actions in pipes[..count].iter().rev() {
        for &action in *actions {
            if !run(schema, action, value, report) {
                return false;
            }
        }
    }
    true
}

/// What a `variant` makes of a value.
enum Selected<'a> {
    Option(NodeId),
    NotObject,
    /// No option has this at the discriminator.
    Unknown(Value<'a>),
}

fn select<'a>(variant: &VariantDef, value: Value<'a>) -> Selected<'a> {
    let Value::Object(fields) = value else {
        return Selected::NotObject;
    };
    let discriminator = fields
        .get(variant.key())
        .map_or(Value::Undefined, Json::view);
    variant
        .select(discriminator)
        .map_or(Selected::Unknown(discriminator), Selected::Option)
}

/// Whether `value` matches a node that looks no further than the value
/// itself. The kinds that do look further are `run`'s.
fn scalar(node: &Node, value: Value<'_>) -> bool {
    match node {
        Node::String => matches!(value, Value::String(_)),
        // JSON has no `NaN`, the one number `number` rejects
        Node::Number => matches!(value, Value::Number(_)),
        Node::Boolean => matches!(value, Value::Bool(_)),
        Node::Unknown => true,
        Node::Literal(literal) => literal.matches(value),
        Node::OneOf(literals) => literals.iter().any(|literal| literal.matches(value)),
        // a length action follows a string or an array, and a number action
        // is never true of anything but a number
        Node::MinLength(min) => length(value).is_some_and(|length| length >= *min),
        Node::MaxLength(max) => length(value).is_some_and(|length| length <= *max),
        Node::MinValue(min) => matches!(value, Value::Number(number) if number >= *min),
        Node::MaxValue(max) => matches!(value, Value::Number(number) if number <= *max),
        Node::Integer => matches!(value, Value::Number(number) if js::is_integer(number)),
        Node::SafeInteger => matches!(value, Value::Number(number) if js::is_safe_integer(number)),
        Node::Finite => matches!(value, Value::Number(number) if number.is_finite()),
        // JSON holds no bigint, and the rest are not scalars
        _ => false,
    }
}

/// The `length` of a string or an array.
fn length(value: Value<'_>) -> Option<f64> {
    match value {
        Value::String(text) => Some(js::length_number(js::utf16_len(text))),
        Value::Array(items) => Some(js::length_number(items.len())),
        _ => None,
    }
}

/// The three object schemas: the entries in the schema's order, each reading
/// a missing key as `undefined`, then for a `strict` one the input's keys.
fn object<R: Report>(
    schema: &Schema,
    id: NodeId,
    entries: &Entries,
    strict: bool,
    value: Value<'_>,
    report: &mut R,
) -> bool {
    let Value::Object(fields) = value else {
        report.fail(id, Failure::Schema, Received::of(value));
        return false;
    };
    let mut matched = true;
    for (key, entry) in entries.iter() {
        let field = fields.get(key).map_or(Value::Undefined, Json::view);
        report.enter(Segment::Key(key));
        let entry_matched = run(schema, entry, field, report);
        report.leave();
        if !entry_matched {
            if R::PROBE {
                return false;
            }
            matched = false;
        }
    }
    if strict {
        // a key in the schema's order is known by its position
        let mut hint = 0;
        for (key, field) in fields.iter() {
            if let Some(position) = entries.position_from(hint, key) {
                if position == hint {
                    hint += 1;
                }
            } else {
                report.enter(Segment::Key(key));
                report.fail(id, Failure::UnknownKey, Received::of(field.view()));
                report.leave();
                if R::PROBE {
                    return false;
                }
                matched = false;
            }
        }
    }
    matched
}

fn record<R: Report>(
    schema: &Schema,
    id: NodeId,
    inner: NodeId,
    value: Value<'_>,
    report: &mut R,
) -> bool {
    let Value::Object(fields) = value else {
        report.fail(id, Failure::Schema, Received::of(value));
        return false;
    };
    let mut matched = true;
    for (key, field) in fields.iter() {
        report.enter(Segment::Key(key));
        let field_matched = run(schema, inner, field.view(), report);
        report.leave();
        if !field_matched {
            if R::PROBE {
                return false;
            }
            matched = false;
        }
    }
    matched
}

fn array<R: Report>(
    schema: &Schema,
    id: NodeId,
    inner: NodeId,
    value: Value<'_>,
    report: &mut R,
) -> bool {
    let Value::Array(items) = value else {
        report.fail(id, Failure::Schema, Received::of(value));
        return false;
    };
    let mut matched = true;
    for (index, item) in items.iter().enumerate() {
        report.enter(Segment::Index(index));
        let item_matched = run(schema, inner, item.view(), report);
        report.leave();
        if !item_matched {
            if R::PROBE {
                return false;
            }
            matched = false;
        }
    }
    matched
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::builder::SchemaBuilder;
    use crate::schema::{Kind, Literal};

    /// A report that goes on past the first failure and keeps each one as
    /// the path to it, the kind that failed, and the type that was there:
    /// what the TypeScript library's issues say.
    #[derive(Debug)]
    struct Collect<'a> {
        schema: &'a Schema,
        path: Vec<String>,
        failures: Vec<String>,
    }

    impl Report for Collect<'_> {
        const PROBE: bool = false;

        fn fail(&mut self, node: NodeId, failure: Failure, received: Received) {
            let kind = match failure {
                Failure::Schema => self.schema.at(node).kind().as_str(),
                Failure::UnknownKey => "unknown_key",
            };
            self.failures.push(format!(
                "{}: {kind} received {received:?}",
                self.path.join(".")
            ));
        }

        fn enter(&mut self, segment: Segment<'_>) {
            self.path.push(match segment {
                Segment::Key(key) => key.to_owned(),
                Segment::Index(index) => index.to_string(),
            });
        }

        fn leave(&mut self) {
            self.path.pop();
        }
    }

    /// A report that keeps the node of each failure.
    #[derive(Debug)]
    struct Ids(Vec<NodeId>);

    impl Report for Ids {
        const PROBE: bool = false;

        fn fail(&mut self, node: NodeId, _: Failure, _: Received) {
            self.0.push(node);
        }

        fn enter(&mut self, _: Segment<'_>) {}

        fn leave(&mut self) {}
    }

    /// Every failure of `text`, checked against the verdict of a probe.
    fn failures(schema: &Schema, text: &str) -> Vec<String> {
        let json = Json::parse(text).unwrap();
        let mut report = Collect {
            schema,
            path: Vec::new(),
            failures: Vec::new(),
        };
        let matched = run(schema, schema.root(), json.view(), &mut report);
        assert_eq!(matched, report.failures.is_empty(), "{text}");
        assert_eq!(matched, is_json(schema, text).unwrap(), "{text}");
        assert!(report.path.is_empty(), "{text}");
        report.failures
    }

    pub fn build(build: impl FnOnce(&mut SchemaBuilder) -> NodeId) -> Schema {
        let mut builder = SchemaBuilder::new();
        let root = build(&mut builder);
        builder.build(root).unwrap()
    }

    fn check(schema: &Schema, valid: &[&str], invalid: &[&str]) {
        for text in valid {
            assert_eq!(is_json(schema, text), Ok(true), "{text}");
        }
        for text in invalid {
            assert_eq!(is_json(schema, text), Ok(false), "{text}");
        }
    }

    const EVERY_TYPE: [&str; 9] = [
        "null", "true", "false", "0", "1.5", r#""""#, r#""a""#, "[]", "{}",
    ];

    fn check_types(schema: &Schema, valid: &[&str]) {
        for text in EVERY_TYPE {
            assert_eq!(is_json(schema, text), Ok(valid.contains(&text)), "{text}");
        }
    }

    #[test]
    fn primitives_match_their_type() {
        check_types(&build(SchemaBuilder::string), &[r#""""#, r#""a""#]);
        check_types(&build(SchemaBuilder::number), &["0", "1.5"]);
        check_types(&build(SchemaBuilder::boolean), &["true", "false"]);
        check_types(&build(SchemaBuilder::bigint), &[]);
        check_types(&build(SchemaBuilder::unknown), &EVERY_TYPE);
    }

    #[test]
    fn literals_match_by_strict_equality() {
        check(
            &build(|b| b.literal(1)),
            &["1", "1.0", "1e0", "10e-1"],
            &["2", r#""1""#, "true"],
        );
        check(
            &build(|b| b.literal(0)),
            &["0", "-0", "0.0", "-0e5"],
            &["false", "null", r#""""#],
        );
        check(&build(|b| b.literal(-0.0)), &["0", "-0"], &[]);
        check(
            &build(|b| b.literal("a")),
            &[r#""a""#, r#""\u0061""#],
            &[r#""A""#, r#""a ""#, "1"],
        );
        check(
            &build(|b| b.literal(true)),
            &["true"],
            &["false", "1", r#""true""#],
        );
        check(
            &build(|b| b.literal(Literal::Null)),
            &["null"],
            &["0", "false", r#""null""#, "[]"],
        );
        check(
            &build(|b| b.literal(0.1 + 0.2)),
            &["0.30000000000000004"],
            &["0.3", "0.30000000000000001"],
        );
        let one_of = build(|b| {
            b.one_of([
                Literal::from("a"),
                Literal::from(1),
                Literal::Null,
                Literal::from(false),
            ])
        });
        check(
            &one_of,
            &[r#""a""#, "1", "1.0", "null", "false"],
            &[r#""b""#, "2", "true", "[]", "{}"],
        );
        check_types(&build(|b| b.one_of::<Literal>([])), &[]);
    }

    #[test]
    fn wrappers_at_the_root_see_no_missing_key() {
        check_types(
            &build(|b| {
                let s = b.string();
                b.optional(s)
            }),
            &[r#""""#, r#""a""#],
        );
        check_types(
            &build(|b| {
                let s = b.string();
                b.nullable(s)
            }),
            &["null", r#""""#, r#""a""#],
        );
        check_types(
            &build(|b| {
                let s = b.string();
                b.with_default(s, Json::String("x".into()))
            }),
            &[r#""""#, r#""a""#],
        );
    }

    #[test]
    fn a_missing_key_is_undefined() {
        let schema = build(|b| {
            let string = b.string();
            let unknown = b.unknown();
            let optional = b.optional(string);
            let nullable = b.nullable(string);
            let default = b.with_default(string, Json::Null);
            b.object([
                ("string", string),
                ("unknown", unknown),
                ("optional", optional),
                ("nullable", nullable),
                ("default", default),
            ])
        });
        check(
            &schema,
            &[
                r#"{"string":"a","nullable":null}"#,
                r#"{"string":"a","nullable":"b","optional":"c","default":"d","unknown":[1]}"#,
                r#"{"nullable":null,"string":""}"#,
            ],
            &[
                "{}",
                r#"{"string":"a"}"#,
                r#"{"nullable":null}"#,
                r#"{"string":"a","nullable":null,"optional":null}"#,
                r#"{"string":"a","nullable":null,"default":null}"#,
                r#"{"string":"a","nullable":null,"default":1}"#,
                r#"{"string":"a","nullable":null,"extra":1}"#,
                r#"{"string":null,"nullable":null}"#,
            ],
        );
        assert_eq!(
            failures(&schema, "{}"),
            [
                "string: string received Undefined",
                "nullable: string received Undefined"
            ]
        );
    }

    #[test]
    fn object_reports_entries_then_unknown_keys() {
        let schema = build(|b| {
            let string = b.string();
            let number = b.number();
            b.object([("b", string), ("a", number), ("2", number)])
        });
        check(
            &schema,
            &[r#"{"b":"x","a":1,"2":2}"#, r#"{"2":2,"a":1,"b":"x"}"#],
            &[
                "[]",
                "null",
                r#""b""#,
                r#"{"b":"x","a":1}"#,
                r#"{"b":"x","a":1,"2":2,"c":3}"#,
                r#"{"b":"x","a":1,"2":2,"__proto__":3}"#,
            ],
        );
        // entries in the schema's order, which puts the index first, then the
        // unknown keys in the input's, which does too
        assert_eq!(
            failures(&schema, r#"{"z":1,"a":"no","7":1,"b":2,"0":null}"#),
            [
                "2: number received Undefined",
                "b: string received Number",
                "a: number received String",
                "0: unknown_key received Null",
                "7: unknown_key received Number",
                "z: unknown_key received Number"
            ]
        );
        assert_eq!(failures(&schema, "[]"), [": object received Array"]);
    }

    #[test]
    fn a_repeated_key_is_its_last_value() {
        let schema = build(|b| {
            let number = b.number();
            b.object([("a", number)])
        });
        check(&schema, &[r#"{"a":"x","a":1}"#], &[r#"{"a":1,"a":"x"}"#]);
    }

    #[test]
    fn loose_and_strip_ignore_unknown_keys() {
        for kind in [Kind::LooseObject, Kind::StripObject] {
            let schema = build(|b| {
                let number = b.number();
                let entries = [("a", number)];
                if kind == Kind::LooseObject {
                    b.loose_object(entries)
                } else {
                    b.strip_object(entries)
                }
            });
            check(
                &schema,
                &[
                    r#"{"a":1}"#,
                    r#"{"a":1,"b":[],"__proto__":null}"#,
                    r#"{"b":1,"a":1,"b":"x"}"#,
                ],
                &["{}", "[]", "null", "1", r#"{"a":"1"}"#, r#"{"b":1}"#],
            );
            assert_eq!(
                failures(&schema, "[]"),
                [format!(": {kind} received Array")]
            );
        }
    }

    #[test]
    fn record_checks_every_value() {
        let schema = build(|b| {
            let number = b.number();
            b.record(number)
        });
        check(
            &schema,
            &["{}", r#"{"a":1,"__proto__":2,"":3}"#, r#"{"a":"x","a":1}"#],
            &[
                "[]",
                "null",
                "1",
                r#"{"a":"x"}"#,
                r#"{"a":1,"__proto__":"x"}"#,
                r#"{"a":1,"a":"x"}"#,
            ],
        );
        assert_eq!(
            failures(&schema, r#"{"b":null,"a":1,"1":[]}"#),
            ["1: number received Array", "b: number received Null"]
        );
    }

    #[test]
    fn array_checks_every_item() {
        let schema = build(|b| {
            let number = b.number();
            let inner = b.array(number);
            b.array(inner)
        });
        check(
            &schema,
            &["[]", "[[]]", "[[1],[2,3],[]]"],
            &["{}", "null", "[1]", "[[1],[null]]", r#"[["1"]]"#, "[[[]]]"],
        );
        assert_eq!(
            failures(&schema, r#"[[1,"x"],2,[null]]"#),
            [
                "0.1: number received String",
                "1: array received Number",
                "2.0: number received Null"
            ]
        );
    }

    #[test]
    fn union_matches_any_option_and_reports_once() {
        let schema = build(|b| {
            let string = b.string();
            let number = b.number();
            let flag = b.boolean();
            let a = b.object([("a", string)]);
            let c = b.object([("a", number), ("c", flag)]);
            b.union([string, a, c])
        });
        check(
            &schema,
            &[r#""x""#, r#"{"a":"x"}"#, r#"{"a":1,"c":true}"#],
            &[
                "1",
                "null",
                "[]",
                "{}",
                r#"{"a":1}"#,
                r#"{"a":"x","c":true}"#,
            ],
        );
        assert_eq!(failures(&schema, r#"{"a":1}"#), [": union received Object"]);
        check_types(&build(|b| b.union([])), &[]);
    }

    #[test]
    fn variant_dispatches_on_the_discriminator() {
        let schema = build(|b| {
            let circle = b.literal("circle");
            let square = b.literal("square");
            let number = b.number();
            let one = b.literal(1);
            let null = b.literal(Literal::Null);
            let a = b.object([("kind", circle), ("r", number)]);
            let s = b.loose_object([("kind", square), ("side", number)]);
            let n = b.strip_object([("kind", one)]);
            let z = b.object([("kind", null)]);
            b.variant("kind", [a, s, n, z])
        });
        check(
            &schema,
            &[
                r#"{"kind":"circle","r":1}"#,
                r#"{"r":1,"kind":"circle"}"#,
                r#"{"kind":"square","side":2,"extra":true}"#,
                r#"{"kind":1}"#,
                r#"{"kind":1.0,"extra":1}"#,
                r#"{"kind":null}"#,
                r#"{"kind":"square","r":"x","kind":"circle","r":1}"#,
            ],
            &[
                "{}",
                "[]",
                "null",
                r#""circle""#,
                r#"{"kind":"circle"}"#,
                r#"{"kind":"circle","r":1,"extra":1}"#,
                r#"{"kind":"triangle"}"#,
                r#"{"kind":"1"}"#,
                r#"{"kind":["circle"],"r":1}"#,
                r#"{"kind":{},"r":1}"#,
                r#"{"r":1}"#,
                r#"{"kind":"circle","r":1,"kind":"square"}"#,
            ],
        );
        assert_eq!(
            failures(&schema, "{}"),
            ["kind: variant received Undefined"]
        );
        assert_eq!(failures(&schema, "[]"), [": variant received Array"]);
        assert_eq!(
            failures(&schema, r#"{"kind":"circle","x":1}"#),
            [
                "r: number received Undefined",
                "x: unknown_key received Number"
            ]
        );
    }

    #[test]
    fn string_pipes_measure_utf16() {
        let schema = build(|b| {
            let string = b.string();
            let min = b.min_length(2.0);
            let max = b.max_length(4.0);
            b.pipe([string, min, max])
        });
        check(
            &schema,
            &[
                r#""ab""#,
                r#""abcd""#,
                r#""😀""#,
                r#""\ud83d\ude00""#,
                r#""😀😀""#,
                r#""a😀b""#,
                r#""é€""#,
                r#""\u0000\u0000""#,
            ],
            &[
                r#""""#,
                r#""a""#,
                r#""é""#,
                r#""abcde""#,
                r#""😀😀a""#,
                "2",
                "null",
                r#"["a","b"]"#,
            ],
        );
        // only the first step that fails reports
        assert_eq!(failures(&schema, "2"), [": string received Number"]);
        assert_eq!(
            failures(&schema, r#""a""#),
            [": min_length received String"]
        );
        let fractional = build(|b| {
            let string = b.string();
            let min = b.min_length(1.5);
            let max = b.max_length(2.5);
            b.pipe([string, min, max])
        });
        check(&fractional, &[r#""ab""#], &[r#""a""#, r#""abc""#]);
    }

    #[test]
    fn an_escaped_surrogate_pair_is_two_units() {
        let exactly = |length: f64| {
            build(|b| {
                let string = b.string();
                let min = b.min_length(length);
                let max = b.max_length(length);
                b.pipe([string, min, max])
            })
        };
        let pair = r#""\ud83d\ude00""#;
        assert_eq!(Json::parse(pair), Ok(Json::String("😀".into())));
        for (length, text) in [
            (2.0, pair),
            (2.0, r#""\uD83D\uDE00""#),
            (3.0, r#""a\ud83d\ude00""#),
            (4.0, r#""\ud83d\ude00\ud83d\ude00""#),
            (1.0, r#""\u00e9""#),
        ] {
            let schema = exactly(length);
            assert_eq!(is_json(&schema, text), Ok(true), "{text}");
            assert_eq!(crate::stream::is_json(&schema, text), Ok(true), "{text}");
            let other = exactly(length + 1.0);
            assert_eq!(is_json(&other, text), Ok(false), "{text}");
            assert_eq!(crate::stream::is_json(&other, text), Ok(false), "{text}");
        }
    }

    #[test]
    fn number_pipes_test_the_value() {
        let integer = build(|b| {
            let number = b.number();
            let integer = b.integer();
            b.pipe([number, integer])
        });
        check(
            &integer,
            &[
                "1",
                "1.0",
                "1e2",
                "0.1e1",
                "4.5e1",
                "-0",
                "1e21",
                "1e308",
                "9007199254740993",
            ],
            &["1.5", "5e-324", "0.1", r#""1""#, "null"],
        );
        let safe = build(|b| {
            let number = b.number();
            let safe = b.safe_integer();
            b.pipe([number, safe])
        });
        check(
            &safe,
            &[
                "9007199254740991",
                "-9007199254740991",
                "9007199254740991.0",
                "0",
            ],
            &[
                "9007199254740992",
                "9007199254740993",
                "-9007199254740992",
                "1e21",
                "1.5",
            ],
        );
        let bounded = build(|b| {
            let number = b.number();
            let min = b.min_value(0.1);
            let max = b.max_value(0.3);
            let finite = b.finite();
            b.pipe([number, min, max, finite])
        });
        check(
            &bounded,
            &[
                "0.1",
                "0.3",
                "0.2",
                "1e-1",
                "0.1000000000000000055511151231257827",
            ],
            &[
                "0.09999999999999999",
                "0.30000000000000004",
                "0",
                "-0.2",
                "1",
            ],
        );
        let zero = build(|b| {
            let number = b.number();
            let min = b.min_value(0.0);
            b.pipe([number, min])
        });
        check(&zero, &["0", "-0", "5e-324"], &["-5e-324", "-1"]);
    }

    #[test]
    fn number_tests_stand_alone() {
        check_types(&build(SchemaBuilder::integer), &["0"]);
        check_types(&build(SchemaBuilder::safe_integer), &["0"]);
        check_types(&build(SchemaBuilder::finite), &["0", "1.5"]);
        let items = build(|b| {
            let integer = b.integer();
            let min = b.min_value(1.0);
            let positive = b.pipe([integer, min]);
            b.array(positive)
        });
        check(
            &items,
            &["[]", "[1,2]"],
            &["[0]", "[1.5]", r#"["1"]"#, "[null]"],
        );
    }

    #[test]
    fn array_pipes_count_items() {
        let schema = build(|b| {
            let number = b.number();
            let array = b.array(number);
            let min = b.min_length(1.0);
            let inner = b.pipe([array, min]);
            let max = b.max_length(2.0);
            b.pipe([inner, max])
        });
        check(
            &schema,
            &["[1]", "[1,2]"],
            &["[]", "[1,2,3]", r#"["a"]"#, r#""ab""#, "{}", "1"],
        );
        // the array's failures, and no length is asked of what failed
        assert_eq!(
            failures(&schema, r#"["a",null,1]"#),
            ["0: number received String", "1: number received Null"]
        );
        assert_eq!(failures(&schema, "[]"), [": min_length received Array"]);
        assert_eq!(
            failures(&schema, "[1,2,3]"),
            [": max_length received Array"]
        );
    }

    #[test]
    fn pipes_of_pipes_run_the_innermost_actions_first() {
        let schema = build(|b| {
            let string = b.string();
            let min = b.min_length(2.0);
            let max = b.max_length(3.0);
            let innermost = b.pipe([string, min, max]);
            let longer = b.min_length(3.0);
            let inner = b.pipe([innermost, longer]);
            let single = b.pipe([inner]);
            let shorter = b.max_length(2.0);
            b.pipe([single, shorter])
        });
        check(
            &schema,
            &[],
            &[r#""a""#, r#""ab""#, r#""abc""#, r#""abcd""#, "1"],
        );
        // one failure each, of the first action to fail from the inside out
        assert_eq!(failures(&schema, "1"), [": string received Number"]);
        assert_eq!(
            failures(&schema, r#""a""#),
            [": min_length received String"]
        );
        assert_eq!(
            failures(&schema, r#""abcd""#),
            [": max_length received String"]
        );
        // of the two `max_length`, the one further in is asked first
        for (text, failed) in [(r#""abcd""#, 2), (r#""abc""#, 7)] {
            let json = Json::parse(text).unwrap();
            let mut ids = Ids(Vec::new());
            assert!(!run(&schema, schema.root(), json.view(), &mut ids));
            assert_eq!(ids.0, [NodeId::new(failed)], "{text}");
        }
        let numbers = build(|b| {
            let integer = b.integer();
            let min = b.min_value(1.0);
            let inner = b.pipe([integer, min]);
            let max = b.max_value(2.0);
            b.pipe([inner, max])
        });
        check(&numbers, &["1", "2"], &["0", "3", "1.5", "[]"]);
    }

    #[test]
    fn recursive_schemas() {
        let json = build(|b| {
            let json = b.declare();
            let null = b.literal(Literal::Null);
            let boolean = b.boolean();
            let number = b.number();
            let string = b.string();
            let array = b.array(json);
            let record = b.record(json);
            let any = b.union([null, boolean, number, string, array, record]);
            b.define(json, any);
            json
        });
        check_types(&json, &EVERY_TYPE);
        check(&json, &[r#"{"a":[1,{"b":[null,"x",[[]]]}]}"#], &[]);
        let tree = build(|b| {
            let tree = b.declare();
            let number = b.number();
            let children = b.array(tree);
            let node = b.object([("value", number), ("children", children)]);
            b.define(tree, node);
            tree
        });
        check(
            &tree,
            &[
                r#"{"value":1,"children":[]}"#,
                r#"{"value":1,"children":[{"value":2,"children":[{"value":3,"children":[]}]}]}"#,
            ],
            &[
                r#"{"value":1}"#,
                r#"{"value":1,"children":[{"value":2}]}"#,
                r#"{"value":1,"children":[{"value":"2","children":[]}]}"#,
            ],
        );
        assert_eq!(
            failures(
                &tree,
                r#"{"value":1,"children":[{"value":2,"children":[1]}]}"#
            ),
            ["children.0.children.0: object received Number"]
        );
    }

    /// The deepest input the parser reads, against the most nesting a schema
    /// may have at every level, on a small stack: what the limit on nesting
    /// is for. A debug build, as the tests are, has the largest frames.
    #[test]
    fn the_deepest_input_under_the_most_nesting_fits_a_small_stack() {
        use crate::schema::MAX_NESTING;
        // three quarters of what a spawned thread has by default
        let stack = 3 << 19;
        let nested = build(|b| {
            let lazy = b.declare();
            let array = b.array(lazy);
            // each union is one more step around the array at every level
            let mut id = array;
            for _ in 0..MAX_NESTING - 1 {
                let never = b.bigint();
                id = b.union([never, id]);
            }
            b.define(lazy, id);
            lazy
        });
        let arrays = build(|b| {
            let lazy = b.declare();
            let array = b.array(lazy);
            b.define(lazy, array);
            lazy
        });
        let objects = build(|b| {
            let lazy = b.declare();
            let optional = b.optional(lazy);
            let object = b.object([("a", optional)]);
            b.define(lazy, object);
            lazy
        });
        let records = build(|b| {
            let lazy = b.declare();
            let record = b.record(lazy);
            b.define(lazy, record);
            lazy
        });
        // a pipe that starts with a pipe, as far as that goes, at every level
        let pipes = |b: &mut SchemaBuilder, mut id: NodeId, count: usize| {
            for _ in 0..count {
                let min = b.min_length(0.0);
                id = b.pipe([id, min]);
            }
            id
        };
        let piped = build(|b| {
            let lazy = b.declare();
            let array = b.array(lazy);
            let id = pipes(b, array, MAX_NESTING - 1);
            b.define(lazy, id);
            lazy
        });
        // and the same under a union, which the streaming evaluator steps
        // through to its one option for an array
        let piped_option = build(|b| {
            let lazy = b.declare();
            let array = b.array(lazy);
            let id = pipes(b, array, MAX_NESTING - 2);
            let never = b.bigint();
            let either = b.union([never, id]);
            b.define(lazy, either);
            lazy
        });
        // the deepest frames of all: one pipe inside as many unions as fit
        let piped_unions = build(|b| {
            let lazy = b.declare();
            let array = b.array(lazy);
            let mut id = pipes(b, array, 1);
            for _ in 0..MAX_NESTING - 2 {
                let never = b.bigint();
                id = b.union([never, id]);
            }
            b.define(lazy, id);
            lazy
        });
        let deepest_array = format!("{}{}", "[".repeat(127), "]".repeat(127));
        let deepest_object = format!("{}{{}}{}", r#"{"a":"#.repeat(126), "}".repeat(126));
        let thread = std::thread::Builder::new()
            .stack_size(stack)
            .spawn(move || {
                for (schema, text) in [
                    (&nested, &deepest_array),
                    (&piped, &deepest_array),
                    (&piped_option, &deepest_array),
                    (&piped_unions, &deepest_array),
                    (&arrays, &deepest_array),
                    (&objects, &deepest_object),
                    (&records, &deepest_object),
                ] {
                    assert_eq!(is_json(schema, text), Ok(true));
                    assert_eq!(crate::stream::is_json(schema, text), Ok(true));
                }
            });
        thread.unwrap().join().unwrap();
    }
}
