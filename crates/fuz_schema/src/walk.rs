//! The tree evaluator: the TypeScript library's `run` functions, over a value
//! held as JavaScript would hold it.
//!
//! This is the reference. Given the tree `Json::parse` builds, it reaches the
//! verdict the TypeScript library reaches on what `JSON.parse` returns. The
//! streaming evaluator hands it every scalar, so the two share one reading of
//! each kind.
//!
//! Failures go to a `Report`. `Probe` only wants the verdict, and evaluation
//! returns at the first failure. `Collect` goes on and keeps each failure as
//! a `SchemaIssue`, the one the TypeScript library's `parse` reports, in its order.
//! A container that had a failure under it prefixes its key onto the paths of
//! those issues, as the library does, so a value that matches builds no path.

use crate::error::JsonError;
use crate::issue::{PathSegment, Received, SchemaIssue, SchemaIssueKind};
use crate::js;
use crate::json::{Json, Value};
use crate::schema::{
    MAX_NESTING, NodeId, Schema, SchemaEntries, SchemaLiteral, SchemaNode, VariantDef,
};

/// Where failures go.
pub trait Report {
    /// Whether only the verdict is wanted, so evaluation stops at the first
    /// failure.
    const PROBE: bool;

    /// A value failed `node`, was at a key `node` does not have, or was not
    /// at the key the entry `node` needs.
    fn fail(&mut self, node: NodeId, failure: Failure, received: Received);

    /// How many failures there have been, to hand back to `prefix`.
    fn count(&self) -> usize;

    /// The failures since there were `from` of them are of values under
    /// `segment` of the current one.
    fn prefix(&mut self, from: usize, segment: Segment<'_>);
}

/// What failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// The value did not match the node.
    Schema,
    /// The value is at the discriminator of the `variant` node, and no option
    /// has it.
    Discriminator,
    /// The value is at a key the `object` node has no entry for.
    UnknownKey,
    /// The node is an `unknown` entry of an object schema, and the value has
    /// no key for it.
    MissingKey,
}

/// A step from a container to a value in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Segment<'a> {
    Key(&'a str),
    Index(usize),
}

/// The report that only wants the verdict.
#[derive(Debug)]
pub struct Probe;

impl Report for Probe {
    const PROBE: bool = true;

    fn fail(&mut self, _: NodeId, _: Failure, _: Received) {}

    fn count(&self) -> usize {
        0
    }

    fn prefix(&mut self, _: usize, _: Segment<'_>) {}
}

/// The report that keeps every failure as an issue.
#[derive(Debug)]
pub struct Collect<'a> {
    schema: &'a Schema,
    /// The issues so far, each with its path innermost first.
    issues: Vec<SchemaIssue>,
}

impl<'a> Collect<'a> {
    pub const fn new(schema: &'a Schema) -> Self {
        Self {
            schema,
            issues: Vec::new(),
        }
    }

    /// The issues, in the order the failures were met, each path now
    /// outermost first.
    pub fn finish(mut self) -> Vec<SchemaIssue> {
        for issue in &mut self.issues {
            issue.path.reverse();
        }
        self.issues
    }
}

impl Report for Collect<'_> {
    const PROBE: bool = false;

    fn fail(&mut self, node: NodeId, failure: Failure, received: Received) {
        let node = self.schema.at(node);
        let kind = match failure {
            Failure::Schema | Failure::Discriminator => SchemaIssueKind::of(node.kind()),
            Failure::UnknownKey => Some(SchemaIssueKind::UnknownKey),
            Failure::MissingKey => Some(SchemaIssueKind::MissingKey),
        };
        // the walker reports no failure of a kind that has no issue kind
        debug_assert!(kind.is_some(), "a `{}` failed", node.kind());
        if let Some(kind) = kind {
            self.issues.push(SchemaIssue {
                kind,
                expected: expected(self.schema, node, failure),
                received,
                path: Vec::new(),
            });
        }
    }

    fn count(&self) -> usize {
        self.issues.len()
    }

    fn prefix(&mut self, from: usize, segment: Segment<'_>) {
        for issue in self.issues.iter_mut().skip(from) {
            issue.path.push(match segment {
                Segment::Key(key) => PathSegment::Key(key.to_owned()),
                Segment::Index(index) => PathSegment::Index(index),
            });
        }
    }
}

/// The `expected` of the issue the TypeScript library reports for `failure`
/// of `node`: the kind's name where the library gives `fail` no other text.
fn expected(schema: &Schema, node: &SchemaNode, failure: Failure) -> String {
    match (failure, node) {
        (Failure::UnknownKey, _) => "no unknown keys".to_owned(),
        (Failure::MissingKey, _) => "a required key".to_owned(),
        // the values of the options, in the order they first appear
        (Failure::Discriminator, SchemaNode::Variant(variant)) => {
            format_literals(variant.table.iter().map(|(literal, _)| literal))
        }
        (
            _,
            SchemaNode::LooseObject(_)
            | SchemaNode::StripObject(_)
            | SchemaNode::Record(_)
            | SchemaNode::Variant(_),
        ) => "object".to_owned(),
        (_, SchemaNode::Literal(literal)) => format_literals([literal]),
        (_, SchemaNode::OneOf(literals)) => format_literals(literals.iter()),
        (_, SchemaNode::Union(options)) => options
            .iter()
            .map(|&option| schema.at(option).kind().as_str())
            .collect::<Vec<_>>()
            .join(" | "),
        (_, SchemaNode::MinLength(min)) => format!("length >= {}", js::number_to_string(*min)),
        (_, SchemaNode::MaxLength(max)) => format!("length <= {}", js::number_to_string(*max)),
        (_, SchemaNode::MinValue(min)) => format!(">= {}", js::number_to_string(*min)),
        (_, SchemaNode::MaxValue(max)) => format!("<= {}", js::number_to_string(*max)),
        _ => node.kind().as_str().to_owned(),
    }
}

/// The library's `format_literals`: each value as JavaScript's `String`
/// writes it, a string quoted as `JSON.stringify` quotes it, joined by ` | `.
fn format_literals<'a>(literals: impl IntoIterator<Item = &'a SchemaLiteral>) -> String {
    literals
        .into_iter()
        .map(|literal| match literal {
            SchemaLiteral::Null => "null".to_owned(),
            SchemaLiteral::Boolean(value) => value.to_string(),
            SchemaLiteral::Number(value) => js::number_to_string(*value),
            SchemaLiteral::String(value) => js::quote(value),
        })
        .collect::<Vec<_>>()
        .join(" | ")
}

/// Whether `text` is JSON that matches `schema`, by parsing all of it into a
/// tree and walking the tree.
pub fn matches_json(schema: &Schema, text: &str) -> Result<bool, JsonError> {
    let json = Json::parse(text)?;
    Ok(run(schema, schema.root(), json.view(), &mut Probe))
}

/// The issues of `text` against `schema`, none when it matches, by parsing
/// all of it into a tree and walking the tree.
pub fn validate_json(schema: &Schema, text: &str) -> Result<Vec<SchemaIssue>, JsonError> {
    let json = Json::parse(text)?;
    let mut report = Collect::new(schema);
    let matched = run(schema, schema.root(), json.view(), &mut report);
    let issues = report.finish();
    // every failure the walker reports is of a kind that has an issue kind,
    // so this holds by construction: a text that fails has an issue
    assert_eq!(matched, issues.is_empty(), "a failure that built no issue");
    Ok(issues)
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
            SchemaNode::Optional(inner) => {
                if matches!(value, Value::Undefined) {
                    return true;
                }
                id = *inner;
            }
            SchemaNode::Nullable(inner) => {
                if matches!(value, Value::Null) {
                    return true;
                }
                id = *inner;
            }
            SchemaNode::WithDefault(default) => {
                if matches!(value, Value::Undefined) {
                    return true;
                }
                id = default.schema();
            }
            SchemaNode::Lazy(inner) => id = *inner,
            SchemaNode::Union(options) => {
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
        SchemaNode::Object(entries) => object(schema, id, entries, true, value, report),
        SchemaNode::LooseObject(entries) | SchemaNode::StripObject(entries) => {
            object(schema, id, entries, false, value, report)
        }
        SchemaNode::Record(inner) => record(schema, id, *inner, value, report),
        SchemaNode::Array(inner) => array(schema, id, *inner, value, report),
        // each step reports its own failure, and the first one ends the pipe
        SchemaNode::Pipe(steps) => pipe(schema, steps, value, report),
        SchemaNode::Variant(variant) => match select(variant, value) {
            Selected::Option(option) => return Rest::Option(option),
            Selected::NotObject => fail(id, value, report),
            Selected::Unknown(discriminator) => fail_at(
                id,
                Failure::Discriminator,
                discriminator,
                Segment::Key(variant.key()),
                report,
            ),
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

/// Reports a failure of `node` about the value at `segment` of the current one.
fn fail_at<R: Report>(
    node: NodeId,
    failure: Failure,
    value: Value<'_>,
    segment: Segment<'_>,
    report: &mut R,
) -> bool {
    let count = report.count();
    report.fail(node, failure, Received::of(value));
    report.prefix(count, segment);
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
        if let SchemaNode::Pipe(inner) = schema.at(head) {
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
fn scalar(node: &SchemaNode, value: Value<'_>) -> bool {
    match node {
        SchemaNode::String => matches!(value, Value::String(_)),
        // JSON has no `NaN`, the one number `number` rejects
        SchemaNode::Number => matches!(value, Value::Number(_)),
        SchemaNode::Boolean => matches!(value, Value::Bool(_)),
        SchemaNode::Unknown => true,
        SchemaNode::Literal(literal) => literal.matches(value),
        SchemaNode::OneOf(literals) => literals.iter().any(|literal| literal.matches(value)),
        // a length action follows a string or an array, and a number action
        // is never true of anything but a number
        SchemaNode::MinLength(min) => length(value).is_some_and(|length| length >= *min),
        SchemaNode::MaxLength(max) => length(value).is_some_and(|length| length <= *max),
        SchemaNode::MinValue(min) => matches!(value, Value::Number(number) if number >= *min),
        SchemaNode::MaxValue(max) => matches!(value, Value::Number(number) if number <= *max),
        SchemaNode::Integer => matches!(value, Value::Number(number) if js::is_integer(number)),
        SchemaNode::SafeInteger => {
            matches!(value, Value::Number(number) if js::is_safe_integer(number))
        }
        SchemaNode::Finite => matches!(value, Value::Number(number) if number.is_finite()),
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
///
/// An entry that is an `unknown` needs its key, as the library's does, which
/// is handed the object and looks. That is of the entry itself: an `unknown`
/// held by another schema is handed no object, and takes the `undefined`.
fn object<R: Report>(
    schema: &Schema,
    id: NodeId,
    entries: &SchemaEntries,
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
        let field = fields.get(key);
        let count = report.count();
        let entry_matched = if field.is_none() && schema.at(entry).needs_key() {
            report.fail(entry, Failure::MissingKey, Received::of(Value::Undefined));
            false
        } else {
            run(
                schema,
                entry,
                field.map_or(Value::Undefined, Json::view),
                report,
            )
        };
        if !entry_matched {
            if R::PROBE {
                return false;
            }
            report.prefix(count, Segment::Key(key));
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
                fail_at(
                    id,
                    Failure::UnknownKey,
                    field.view(),
                    Segment::Key(key),
                    report,
                );
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
        let count = report.count();
        if !run(schema, inner, field.view(), report) {
            if R::PROBE {
                return false;
            }
            report.prefix(count, Segment::Key(key));
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
        let count = report.count();
        if !run(schema, inner, item.view(), report) {
            if R::PROBE {
                return false;
            }
            report.prefix(count, Segment::Index(index));
            matched = false;
        }
    }
    matched
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::builder::SchemaBuilder;
    use crate::schema::{SchemaKind, SchemaLiteral};

    /// A report that keeps the node of each failure.
    #[derive(Debug)]
    struct Ids(Vec<NodeId>);

    impl Report for Ids {
        const PROBE: bool = false;

        fn fail(&mut self, node: NodeId, _: Failure, _: Received) {
            self.0.push(node);
        }

        fn count(&self) -> usize {
            self.0.len()
        }

        fn prefix(&mut self, _: usize, _: Segment<'_>) {}
    }

    /// Every issue of `text`, checked against the verdict of a probe.
    fn issues(schema: &Schema, text: &str) -> Vec<SchemaIssue> {
        let issues = validate_json(schema, text).unwrap();
        assert_eq!(
            issues.is_empty(),
            matches_json(schema, text).unwrap(),
            "{text}"
        );
        issues
    }

    /// Every issue of `text` as its path, its kind, and the type that was
    /// there.
    fn failures(schema: &Schema, text: &str) -> Vec<String> {
        issues(schema, text)
            .iter()
            .map(|issue| {
                let path: Vec<String> = issue
                    .path()
                    .iter()
                    .map(|segment| match segment {
                        PathSegment::Key(key) => key.clone(),
                        PathSegment::Index(index) => index.to_string(),
                    })
                    .collect();
                format!(
                    "{}: {} received {:?}",
                    path.join("."),
                    issue.kind(),
                    issue.received()
                )
            })
            .collect()
    }

    /// Every issue of `text` as its `expected`.
    fn expects(schema: &Schema, text: &str) -> Vec<String> {
        issues(schema, text)
            .iter()
            .map(|issue| issue.expected().to_owned())
            .collect()
    }

    pub fn build(build: impl FnOnce(&mut SchemaBuilder) -> NodeId) -> Schema {
        let mut builder = SchemaBuilder::new();
        let root = build(&mut builder);
        builder.build(root).unwrap()
    }

    fn check(schema: &Schema, valid: &[&str], invalid: &[&str]) {
        for text in valid {
            assert_eq!(matches_json(schema, text), Ok(true), "{text}");
        }
        for text in invalid {
            assert_eq!(matches_json(schema, text), Ok(false), "{text}");
        }
    }

    const EVERY_TYPE: [&str; 9] = [
        "null", "true", "false", "0", "1.5", r#""""#, r#""a""#, "[]", "{}",
    ];

    fn check_types(schema: &Schema, valid: &[&str]) {
        for text in EVERY_TYPE {
            assert_eq!(
                matches_json(schema, text),
                Ok(valid.contains(&text)),
                "{text}"
            );
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
            &build(|b| b.literal(SchemaLiteral::Null)),
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
                SchemaLiteral::from("a"),
                SchemaLiteral::from(1),
                SchemaLiteral::Null,
                SchemaLiteral::from(false),
            ])
        });
        check(
            &one_of,
            &[r#""a""#, "1", "1.0", "null", "false"],
            &[r#""b""#, "2", "true", "[]", "{}"],
        );
        check_types(&build(|b| b.one_of::<SchemaLiteral>([])), &[]);
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
            let held = b.nullable(unknown);
            let either = b.union([string, unknown]);
            b.object([
                ("string", string),
                ("unknown", unknown),
                ("optional", optional),
                ("nullable", nullable),
                ("default", default),
                ("held", held),
                ("either", either),
            ])
        });
        check(
            &schema,
            &[
                r#"{"string":"a","unknown":null,"nullable":null}"#,
                r#"{"string":"a","nullable":"b","optional":"c","default":"d","unknown":[1],"held":1,"either":2}"#,
                r#"{"nullable":null,"unknown":0,"string":""}"#,
            ],
            &[
                "{}",
                r#"{"string":"a","unknown":1}"#,
                r#"{"nullable":null,"unknown":1}"#,
                // an `unknown` entry accepts any value and needs its key
                r#"{"string":"a","nullable":null}"#,
                r#"{"string":"a","unknown":1,"nullable":null,"optional":null}"#,
                r#"{"string":"a","unknown":1,"nullable":null,"default":null}"#,
                r#"{"string":"a","unknown":1,"nullable":null,"default":1}"#,
                r#"{"string":"a","unknown":1,"nullable":null,"extra":1}"#,
                r#"{"string":null,"unknown":1,"nullable":null}"#,
            ],
        );
        // in the order of the entries, and not of an `unknown` another schema
        // holds
        assert_eq!(
            failures(&schema, "{}"),
            [
                "string: string received Undefined",
                "unknown: missing_key received Undefined",
                "nullable: string received Undefined"
            ]
        );
        assert_eq!(
            expects(&schema, r#"{"string":"a","nullable":null}"#),
            ["a required key"]
        );
        // and before the unknown keys
        assert_eq!(
            failures(&schema, r#"{"z":1,"string":"a","nullable":1}"#),
            [
                "unknown: missing_key received Undefined",
                "nullable: string received Number",
                "z: unknown_key received Number"
            ]
        );
        for kind in [SchemaKind::LooseObject, SchemaKind::StripObject] {
            let schema = build(|b| {
                let unknown = b.unknown();
                let optional = b.optional(unknown);
                let entries = [("a", unknown), ("b", optional)];
                if kind == SchemaKind::LooseObject {
                    b.loose_object(entries)
                } else {
                    b.strip_object(entries)
                }
            });
            check(
                &schema,
                &[r#"{"a":null}"#, r#"{"z":1,"a":1}"#],
                &["{}", r#"{"b":1}"#],
            );
            assert_eq!(
                failures(&schema, r#"{"z":1}"#),
                ["a: missing_key received Undefined"],
                "{kind}"
            );
        }
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
        for kind in [SchemaKind::LooseObject, SchemaKind::StripObject] {
            let schema = build(|b| {
                let number = b.number();
                let entries = [("a", number)];
                if kind == SchemaKind::LooseObject {
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
            let null = b.literal(SchemaLiteral::Null);
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
            assert_eq!(matches_json(&schema, text), Ok(true), "{text}");
            assert_eq!(
                crate::stream::matches_json(&schema, text),
                Ok(true),
                "{text}"
            );
            let other = exactly(length + 1.0);
            assert_eq!(matches_json(&other, text), Ok(false), "{text}");
            assert_eq!(
                crate::stream::matches_json(&other, text),
                Ok(false),
                "{text}"
            );
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
            let null = b.literal(SchemaLiteral::Null);
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

    #[test]
    fn issues_say_what_was_expected() {
        // the kind's own name
        type Make = fn(&mut SchemaBuilder) -> NodeId;
        let kinds: [(Make, &str); 7] = [
            (SchemaBuilder::string, "string"),
            (SchemaBuilder::number, "number"),
            (SchemaBuilder::boolean, "boolean"),
            (SchemaBuilder::bigint, "bigint"),
            (SchemaBuilder::integer, "integer"),
            (SchemaBuilder::safe_integer, "safe_integer"),
            (SchemaBuilder::finite, "finite"),
        ];
        for (make, kind) in kinds {
            let schema = build(make);
            assert_eq!(expects(&schema, "null"), [kind]);
            assert_eq!(
                failures(&schema, "null"),
                [format!(": {kind} received Null")]
            );
        }
        // `object` and `array` name themselves, the other object schemas `object`
        let number = |b: &mut SchemaBuilder| b.number();
        assert_eq!(expects(&build(|b| b.object::<&str>([])), "[]"), ["object"]);
        assert_eq!(
            expects(&build(|b| b.loose_object::<&str>([])), "1"),
            ["object"]
        );
        assert_eq!(
            expects(&build(|b| b.strip_object::<&str>([])), "null"),
            ["object"]
        );
        assert_eq!(
            expects(
                &build(|b| {
                    let number = number(b);
                    b.record(number)
                }),
                "[]"
            ),
            ["object"]
        );
        assert_eq!(
            expects(
                &build(|b| {
                    let number = number(b);
                    b.array(number)
                }),
                "{}"
            ),
            ["array"]
        );
        assert_eq!(
            expects(&build(|b| b.object::<&str>([])), r#"{"a":1,"b":[]}"#),
            ["no unknown keys", "no unknown keys"]
        );
    }

    #[test]
    fn literals_are_written_as_javascript_writes_them() {
        assert_eq!(expects(&build(|b| b.literal("a")), "1"), [r#""a""#]);
        assert_eq!(
            expects(&build(|b| b.literal("a\"b\nc")), "1"),
            [r#""a\"b\nc""#]
        );
        assert_eq!(expects(&build(|b| b.literal(-0.0)), "1"), ["0"]);
        assert_eq!(expects(&build(|b| b.literal(1e21)), "1"), ["1e+21"]);
        assert_eq!(expects(&build(|b| b.literal(1e-7)), "1"), ["1e-7"]);
        assert_eq!(
            expects(&build(|b| b.literal(0.1 + 0.2)), "1"),
            ["0.30000000000000004"]
        );
        assert_eq!(expects(&build(|b| b.literal(true)), "1"), ["true"]);
        assert_eq!(
            expects(&build(|b| b.literal(SchemaLiteral::Null)), "1"),
            ["null"]
        );
        let one_of = build(|b| {
            b.one_of([
                SchemaLiteral::from("a"),
                SchemaLiteral::from(1),
                SchemaLiteral::Null,
                SchemaLiteral::from(false),
                SchemaLiteral::from("null"),
                SchemaLiteral::from(-1.5),
            ])
        });
        assert_eq!(
            expects(&one_of, "[]"),
            [r#""a" | 1 | null | false | "null" | -1.5"#]
        );
        assert_eq!(failures(&one_of, "[]"), [": one_of received Array"]);
        assert_eq!(
            expects(&build(|b| b.one_of::<SchemaLiteral>([])), "1"),
            [""]
        );
    }

    #[test]
    fn bounds_are_written_as_javascript_writes_them() {
        let schema = build(|b| {
            let number = b.number();
            let min = b.min_value(-0.0);
            let max = b.max_value(1e21);
            let bounded = b.pipe([number, min, max]);
            let string = b.string();
            let longer = b.min_length(1.5);
            let shorter = b.max_length(1e21);
            let text = b.pipe([string, longer, shorter]);
            let none = b.max_length(-1.0);
            let never = b.pipe([string, none]);
            b.loose_object([("n", bounded), ("s", text), ("x", never)])
        });
        assert_eq!(
            expects(&schema, r#"{"n":-1,"s":"a","x":""}"#),
            [">= 0", "length >= 1.5", "length <= -1"]
        );
        assert_eq!(
            failures(&schema, r#"{"n":1e22,"s":"a","x":""}"#),
            [
                "n: max_value received Number",
                "s: min_length received String",
                "x: max_length received String"
            ]
        );
        assert_eq!(
            expects(&schema, r#"{"n":1e22,"s":"ab","x":""}"#),
            ["<= 1e+21", "length <= -1"]
        );
    }

    #[test]
    fn a_union_expects_the_kinds_of_its_options() {
        let schema = build(|b| {
            let string = b.string();
            let one = b.literal(1);
            let optional = b.optional(string);
            let integer = b.integer();
            let min = b.min_value(0.0);
            let piped = b.pipe([integer, min]);
            let loose = b.loose_object([("a", string)]);
            let lazy = b.declare();
            b.define(lazy, loose);
            let inner = b.union([string]);
            b.union([string, one, optional, piped, loose, lazy, inner])
        });
        assert_eq!(
            expects(&schema, "null"),
            ["string | literal | optional | pipe | loose_object | lazy | union"]
        );
        assert_eq!(expects(&build(|b| b.union([])), "null"), [""]);
    }

    #[test]
    fn a_variant_expects_an_object_then_the_values_of_its_options() {
        let schema = build(|b| {
            let a = b.literal("a");
            let zero = b.literal(0.0);
            let negative_zero = b.literal(-0.0);
            let null = b.literal(SchemaLiteral::Null);
            let yes = b.literal(true);
            let number = b.number();
            let first = b.object([("k", a), ("n", number)]);
            let second = b.object([("k", zero)]);
            let third = b.loose_object([("k", a)]);
            let fourth = b.object([("k", negative_zero)]);
            let fifth = b.object([("k", null)]);
            let sixth = b.object([("k", yes)]);
            b.variant("k", [first, second, third, fourth, fifth, sixth])
        });
        assert_eq!(expects(&schema, "[]"), ["object"]);
        assert_eq!(expects(&schema, "null"), ["object"]);
        // each value once, where it first appears
        let values = r#""a" | 0 | null | true"#;
        assert_eq!(expects(&schema, "{}"), [values]);
        assert_eq!(expects(&schema, r#"{"k":[]}"#), [values]);
        assert_eq!(
            failures(&schema, r#"{"k":{}}"#),
            ["k: variant received Object"]
        );
        assert_eq!(failures(&schema, "[]"), [": variant received Array"]);
        // the option a value given twice selects is the later one
        assert_eq!(expects(&schema, r#"{"k":"a","n":"x"}"#), [""; 0]);
        assert_eq!(
            failures(&schema, r#"{"k":0,"n":1}"#),
            ["n: unknown_key received Number"]
        );
        assert_eq!(expects(&build(|b| b.variant("k", [])), "{}"), [""]);
    }

    #[test]
    fn paths_tell_a_key_from_an_index() {
        let schema = build(|b| {
            let number = b.number();
            let items = b.array(number);
            let fields = b.record(items);
            b.array(fields)
        });
        let issues = issues(&schema, r#"[{"0":[1,null],"a":[[]],"b":1},2]"#);
        let paths: Vec<&[PathSegment]> = issues.iter().map(SchemaIssue::path).collect();
        let key = |key: &str| PathSegment::Key(key.to_owned());
        assert_eq!(
            paths,
            [
                &[PathSegment::Index(0), key("0"), PathSegment::Index(1)][..],
                &[PathSegment::Index(0), key("a"), PathSegment::Index(0)],
                &[PathSegment::Index(0), key("b")],
                &[PathSegment::Index(1)],
            ]
        );
        let kinds: Vec<SchemaIssueKind> = issues.iter().map(SchemaIssue::kind).collect();
        assert_eq!(
            kinds,
            [
                SchemaIssueKind::Number,
                SchemaIssueKind::Number,
                SchemaIssueKind::Array,
                SchemaIssueKind::Record
            ]
        );
    }

    /// The interchange form a TypeScript schema serializes to has its
    /// entries in JavaScript's order already. One written by hand need not,
    /// and reports in that order all the same.
    #[test]
    fn a_schema_loaded_out_of_key_order_reports_in_javascript_order() {
        let number = r#"{"kind":"number"}"#;
        let schema = Schema::from_json(&format!(
            r#"{{"schema":{{"kind":"object","def":{{"b":{number},"10":{number},"a":{number},"2":{number},"01":{number}}}}}}}"#
        ))
        .unwrap();
        assert_eq!(
            failures(&schema, r#"{"z":1,"3":1}"#),
            [
                "2: number received Undefined",
                "10: number received Undefined",
                "b: number received Undefined",
                "a: number received Undefined",
                "01: number received Undefined",
                "3: unknown_key received Number",
                "z: unknown_key received Number"
            ]
        );
    }

    /// The entries of a schema built out of JavaScript's key order run in
    /// it all the same, whichever object schema they are of: what
    /// `Object.keys` gives of the same entries.
    #[test]
    fn a_schema_built_out_of_key_order_reports_in_javascript_order() {
        let keys = ["b", "10", "a", "2", "01", "4294967295", "0"];
        let entries = [
            "0: number received Undefined",
            "2: number received Undefined",
            "10: number received Undefined",
            "b: number received Undefined",
            "a: number received Undefined",
            "01: number received Undefined",
            "4294967295: number received Undefined",
        ];
        let unknown = [
            "3: unknown_key received Number",
            "z: unknown_key received Number",
        ];
        for kind in [
            SchemaKind::Object,
            SchemaKind::LooseObject,
            SchemaKind::StripObject,
        ] {
            let schema = build(|b| {
                let number = b.number();
                let entries = keys.map(|key| (key, number));
                match kind {
                    SchemaKind::Object => b.object(entries),
                    SchemaKind::LooseObject => b.loose_object(entries),
                    _ => b.strip_object(entries),
                }
            });
            let mut expected = entries.to_vec();
            if kind == SchemaKind::Object {
                expected.extend(unknown);
            }
            assert_eq!(failures(&schema, r#"{"z":1,"3":1}"#), expected, "{kind}");
        }
        // and the entries of the option a `variant` selects
        let schema = build(|b| {
            let number = b.number();
            let x = b.literal("x");
            let option = b.object([("b", number), ("10", number), ("k", x), ("2", number)]);
            b.variant("k", [option])
        });
        assert_eq!(
            failures(&schema, r#"{"k":"x","z":1,"3":1}"#),
            [
                "2: number received Undefined",
                "10: number received Undefined",
                "b: number received Undefined",
                "3: unknown_key received Number",
                "z: unknown_key received Number",
            ]
        );
    }

    #[test]
    fn validate_json_reports_what_is_not_json() {
        let schema = build(SchemaBuilder::number);
        assert_eq!(validate_json(&schema, "1"), Ok(Vec::new()));
        for text in ["", "{", "1 2", "1e400", r#"{"a":1,}"#] {
            assert_eq!(
                validate_json(&schema, text).map_err(|error| error.kind()),
                Err(matches_json(&schema, text).unwrap_err().kind()),
                "{text}"
            );
        }
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
                    assert_eq!(matches_json(schema, text), Ok(true));
                    assert_eq!(crate::stream::matches_json(schema, text), Ok(true));
                    assert_eq!(validate_json(schema, text), Ok(Vec::new()));
                }
            });
        thread.unwrap().join().unwrap();
    }
}
