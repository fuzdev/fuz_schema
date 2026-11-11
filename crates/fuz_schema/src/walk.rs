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
//! a `SchemaIssue`, the one the TypeScript library's `parse` reports, in its
//! order, up to `MAX_ISSUES` of them.
//! A container that had a failure under it prefixes its key onto the paths of
//! those issues, as the library does, so a value that matches builds no path.
//!
//! A union `Schema::memoizes_on` names keeps its verdicts on the arrays or
//! objects of the tree, so however many of its recursive options reach one
//! value again, it computes its verdict on it once. The verdicts are held by
//! the report's `Probe` and dropped with it.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use crate::error::JsonError;
use crate::format;
use crate::issue::{MAX_ISSUES, PathSegment, Received, SchemaIssue, SchemaIssueKind};
use crate::js;
use crate::json::{Json, Value};
use crate::schema::{
    Container, MAX_NESTING, NodeId, Schema, SchemaEntries, SchemaLiteral, SchemaNode, VariantDef,
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

    /// The probe a `union` runs its options with, which holds the verdicts
    /// kept so far in this evaluation.
    fn probe(&mut self) -> &mut Probe;
}

/// What failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// The value did not match the node, a schema that fails with issues of
    /// this kind.
    Schema(SchemaIssueKind),
    /// The value is at the discriminator of the `variant` node, and no option
    /// has it.
    Discriminator,
    /// The value is at a key the `object` node has no entry for.
    UnknownKey,
    /// The node is an `unknown` that an entry of an object schema reached,
    /// and the value has no key for the entry.
    MissingKey,
}

impl Failure {
    /// The kind of the issue the TypeScript library reports for it.
    pub const fn issue_kind(self) -> SchemaIssueKind {
        match self {
            Self::Schema(kind) => kind,
            Self::Discriminator => SchemaIssueKind::Variant,
            Self::UnknownKey => SchemaIssueKind::UnknownKey,
            Self::MissingKey => SchemaIssueKind::MissingKey,
        }
    }
}

/// A step from a container to a value in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Segment<'a> {
    Key(&'a str),
    Index(usize),
}

/// The report that only wants the verdict.
///
/// It holds the verdicts the memoized unions have kept, for one tree: a probe
/// is never handed a second tree, whose arrays and objects can have the
/// addresses of the first's.
#[derive(Debug, Default)]
pub struct Probe {
    memo: Memo,
}

impl Report for Probe {
    const PROBE: bool = true;

    fn fail(&mut self, _: NodeId, _: Failure, _: Received) {}

    fn count(&self) -> usize {
        0
    }

    fn prefix(&mut self, _: usize, _: Segment<'_>) {}

    fn probe(&mut self) -> &mut Probe {
        self
    }
}

type MemoKey = (NodeId, Container, usize);

/// A multiplicative hash of a key's words.
///
/// A key is a node id and an address the allocator gave the tree, which no
/// text chooses, so it is not seeded.
#[derive(Debug, Default)]
struct MemoHasher(u64);

impl std::hash::Hasher for MemoHasher {
    fn finish(&self) -> u64 {
        // the product's entropy is in its high bits, and a table's index is
        // its low ones
        self.0.rotate_left(26)
    }

    fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.write_u64(u64::from(byte));
        }
    }

    fn write_u64(&mut self, word: u64) {
        self.0 = (self.0.rotate_left(5) ^ word).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }

    fn write_u32(&mut self, word: u32) {
        self.write_u64(u64::from(word));
    }

    fn write_usize(&mut self, word: usize) {
        self.write_u64(word as u64);
    }
}

/// The verdicts of the unions `Schema::memoizes_on` names, on the arrays and
/// objects of one tree, for as long as the tree lives.
///
/// A `union` two of whose options reach a cycle can be asked of one value
/// once per option of every such union above it, which is exponential in the
/// depth of the input. Its verdict is a function of the node and the value
/// alone, so it is kept the first time and read after.
#[derive(Debug, Default)]
struct Memo {
    /// By node, container, and address. Not made until the first verdict is
    /// kept.
    verdicts: Option<HashMap<MemoKey, bool, std::hash::BuildHasherDefault<MemoHasher>>>,
}

impl Memo {
    /// The key of `value` for the union `id`, when it is an array or object
    /// the union keeps its verdicts on.
    ///
    /// An array is known by the address of its items and an object by its
    /// own, which no other array, or other object, of the tree shares while
    /// it lives: every empty array has one address, and the same verdict. An
    /// array's address could be an object's, by layout, so the key says which
    /// it is.
    fn key(schema: &Schema, id: NodeId, value: Value<'_>) -> Option<MemoKey> {
        let (container, address) = match value {
            Value::Array(items) => (Container::Array, items.as_ptr().addr()),
            Value::Object(object) => (Container::Object, std::ptr::from_ref(object).addr()),
            _ => return None,
        };
        schema
            .memoizes_on(id, container)
            .then_some((id, container, address))
    }

    fn get(&self, key: MemoKey) -> Option<bool> {
        self.verdicts.as_ref()?.get(&key).copied()
    }

    fn insert(&mut self, key: MemoKey, matched: bool) {
        self.verdicts.get_or_insert_default().insert(key, matched);
    }
}

/// The report that keeps each failure as an issue, the first `MAX_ISSUES`.
#[derive(Debug)]
pub struct Collect<'a> {
    schema: &'a Schema,
    /// What its unions run their options with.
    probe: Probe,
    /// The issues so far, each with its path innermost first.
    issues: Vec<SchemaIssue>,
}

impl<'a> Collect<'a> {
    pub const fn new(schema: &'a Schema) -> Self {
        Self {
            schema,
            probe: Probe {
                memo: Memo { verdicts: None },
            },
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
        // past the cap a failure builds no issue, as in the library. The
        // count stays at the cap, so a container's prefix from it reaches none
        if self.issues.len() >= MAX_ISSUES {
            return;
        }
        let at = self.schema.at(node);
        // a schema fails with the issue kind of its own kind
        debug_assert!(
            !matches!(failure, Failure::Schema(kind) if SchemaIssueKind::of(at.kind()) != Some(kind)),
            "a `{}` failed as {failure:?}",
            at.kind()
        );
        self.issues.push(SchemaIssue {
            kind: failure.issue_kind(),
            expected: expected(self.schema, node, at, failure),
            received,
            path: Vec::new(),
        });
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

    fn probe(&mut self) -> &mut Probe {
        &mut self.probe
    }
}

/// The `expected` of the issue the TypeScript library reports for `failure`
/// of `node`, whose id is `id`: the kind's name where the library gives `fail`
/// no other text.
fn expected(schema: &Schema, id: NodeId, node: &SchemaNode, failure: Failure) -> String {
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
        (_, SchemaNode::Union(_)) => schema.union_expected(id).to_owned(),
        (_, SchemaNode::MinLength(min)) => format!("length >= {}", js::number_to_string(*min)),
        (_, SchemaNode::MaxLength(max)) => format!("length <= {}", js::number_to_string(*max)),
        (_, SchemaNode::MinValue(min)) => format!(">= {}", js::number_to_string(*min)),
        (_, SchemaNode::MaxValue(max)) => format!("<= {}", js::number_to_string(*max)),
        _ => node.kind().as_str().to_owned(),
    }
}

/// The `expected` of a failed `union` with `options`: what each option adds,
/// joined by ` | `, as the library's `union` writes it.
///
/// `SchemaBuilder::build` writes it once for each union, as the library writes
/// it once for each and keeps it, so a union that fails many times, or names
/// many values, costs its text once.
pub fn union_expected(nodes: &[SchemaNode], options: &[NodeId]) -> Box<str> {
    let mut parts = Parts::default();
    for &option in options {
        describe_option(nodes, option, &mut parts);
    }
    parts.order.join(" | ").into_boxed_str()
}

/// The parts of a union's `expected`, each once by its text, in the order
/// they first appear, as the library's `Set` keeps them.
#[derive(Default)]
struct Parts {
    order: Vec<Cow<'static, str>>,
    seen: HashSet<Cow<'static, str>>,
}

impl Parts {
    /// Adds `part` unless a part of the same text is there.
    fn add(&mut self, part: Cow<'static, str>) {
        if !self.seen.contains(&part) {
            self.seen.insert(part.clone());
            self.order.push(part);
        }
    }
}

/// What an option adds to a union's `expected`, as the library's
/// `describe_option` has it, each part once by its text, where it first
/// appears: a union its options', at any depth, a `pipe` what its first
/// schema adds, a `literal` or a `one_of` each value as `format_literals`
/// writes it, any object schema `object`, an `optional` or a `with_default`
/// what its schema adds, a `nullable` that and then `null`, and any other node
/// its kind. A `lazy` is its kind, so a recursive union is never followed back
/// to itself, and the builder bounds the rest.
fn describe_option(nodes: &[SchemaNode], id: NodeId, parts: &mut Parts) {
    match &nodes[id.index()] {
        SchemaNode::Union(options) => {
            for &option in options {
                describe_option(nodes, option, parts);
            }
        }
        SchemaNode::Pipe(steps) => {
            if let Some(&first) = steps.first() {
                describe_option(nodes, first, parts);
            }
        }
        SchemaNode::Literal(literal) => parts.add(Cow::Owned(format_literal(literal))),
        SchemaNode::OneOf(literals) => {
            for literal in literals {
                parts.add(Cow::Owned(format_literal(literal)));
            }
        }
        SchemaNode::Object(_)
        | SchemaNode::LooseObject(_)
        | SchemaNode::StripObject(_)
        | SchemaNode::Record(_)
        | SchemaNode::Variant(_) => parts.add(Cow::Borrowed("object")),
        SchemaNode::Optional(inner) => describe_option(nodes, *inner, parts),
        SchemaNode::WithDefault(def) => describe_option(nodes, def.schema, parts),
        SchemaNode::Nullable(inner) => {
            describe_option(nodes, *inner, parts);
            parts.add(Cow::Borrowed("null"));
        }
        node => parts.add(Cow::Borrowed(node.kind().as_str())),
    }
}

/// The library's `format_literals`: each value as `format_literal` writes it,
/// joined by ` | `.
fn format_literals<'a>(literals: impl IntoIterator<Item = &'a SchemaLiteral>) -> String {
    literals
        .into_iter()
        .map(format_literal)
        .collect::<Vec<_>>()
        .join(" | ")
}

/// A value as JavaScript's `String` writes it, a string quoted as
/// `JSON.stringify` quotes it.
fn format_literal(literal: &SchemaLiteral) -> String {
    match literal {
        SchemaLiteral::Null => "null".to_owned(),
        SchemaLiteral::Boolean(value) => value.to_string(),
        SchemaLiteral::Number(value) => js::number_to_string(*value),
        SchemaLiteral::String(value) => js::quote(value),
    }
}

/// Whether `text` is JSON that matches `schema`, by parsing all of it into a
/// tree and walking the tree.
pub fn matches_json(schema: &Schema, text: &str) -> Result<bool, JsonError> {
    let json = Json::parse(text)?;
    Ok(run(
        schema,
        schema.root(),
        json.view(),
        &mut Probe::default(),
    ))
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
                if union(schema, id, options, value, report.probe()) {
                    return true;
                }
                return fail(id, SchemaIssueKind::Union, value, report);
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
        SchemaNode::Object(entries) => {
            object(schema, id, entries, SchemaIssueKind::Object, value, report)
        }
        SchemaNode::LooseObject(entries) => object(
            schema,
            id,
            entries,
            SchemaIssueKind::LooseObject,
            value,
            report,
        ),
        SchemaNode::StripObject(entries) => object(
            schema,
            id,
            entries,
            SchemaIssueKind::StripObject,
            value,
            report,
        ),
        SchemaNode::Record(inner) => record(schema, id, *inner, value, report),
        SchemaNode::Array(inner) => array(schema, id, *inner, value, report),
        // each step reports its own failure, and the first one ends the pipe
        SchemaNode::Pipe(steps) => pipe(schema, steps, value, report),
        SchemaNode::Variant(variant) => match select(variant, value) {
            Selected::Option(option) => return Rest::Option(option),
            Selected::NotObject => fail(id, SchemaIssueKind::Variant, value, report),
            Selected::Unknown(discriminator) => fail_at(
                id,
                Failure::Discriminator,
                discriminator,
                Segment::Key(variant.key()),
                report,
            ),
        },
        // the one thing an `unknown` refuses is no value at all: the key of
        // the entry it was reached from is missing
        SchemaNode::Unknown if matches!(value, Value::Undefined) => {
            report.fail(id, Failure::MissingKey, Received::of(value));
            false
        }
        _ => match scalar(node, value) {
            Ok(()) => true,
            Err(kind) => fail(id, kind, value, report),
        },
    };
    Rest::Matched(matched)
}

/// Reports that `value` does not match the node `id`, which fails with
/// issues of `kind`.
fn fail<R: Report>(id: NodeId, kind: SchemaIssueKind, value: Value<'_>, report: &mut R) -> bool {
    report.fail(id, Failure::Schema(kind), Received::of(value));
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
/// reports itself and not what its options found. They share `probe`, so a
/// verdict one of them keeps is read by the next.
///
/// A union the schema memoizes reads its verdict back, or keeps the one it
/// reaches. That is done here and not in a function of its own, which would
/// be one more frame for every union around a value.
fn union(
    schema: &Schema,
    id: NodeId,
    options: &[NodeId],
    value: Value<'_>,
    probe: &mut Probe,
) -> bool {
    let key = Memo::key(schema, id, value);
    if let Some(key) = key
        && let Some(matched) = probe.memo.get(key)
    {
        return matched;
    }
    let mut matched = false;
    for &option in options {
        // a test that bounds the work gives up here, keeping nothing
        #[cfg(test)]
        if !tests::count_option_run() {
            return false;
        }
        if run(schema, option, value, probe) {
            matched = true;
            break;
        }
    }
    if let Some(key) = key {
        probe.memo.insert(key, matched);
    }
    matched
}

/// The steps of a pipe in order, each reporting its own failure, the first of
/// which ends it.
///
/// A pipe can start with a pipe. Those are followed down to the schema they
/// all start with, keeping each one's actions, so that however many there are
/// they cost the frames of one.
///
/// A `to_lower_case` gives the actions after it the string lowercase, which
/// `build` lets follow only a string, so the value it is given is one.
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
        // `build` lets no more pipes than this start with one another, so a
        // bound that drifts from its own panics in a debug build and fails the
        // match in a release one
        let Some(pipe) = pipes.get_mut(count) else {
            debug_assert!(false, "more pipes start with one another than `build` lets");
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
    // what a `to_lower_case` made of the string, which the actions after it are given
    let mut lowered: Option<String> = None;
    // the innermost pipe's actions are the first to follow the schema
    for actions in pipes[..count].iter().rev() {
        for &action in *actions {
            let current = lowered.as_deref().map_or(value, Value::String);
            if matches!(schema.at(action), SchemaNode::ToLowerCase) {
                if let Value::String(text) = current {
                    lowered = Some(js::to_lower_case(text));
                }
            } else if !run(schema, action, current, report) {
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
/// itself, or the kind of the issue the node fails it with. The kinds that do
/// look further are `run`'s and `rest`'s, and so is an `unknown` given a
/// missing key.
fn scalar(node: &SchemaNode, value: Value<'_>) -> Result<(), SchemaIssueKind> {
    let (matched, kind) = match node {
        SchemaNode::String => (matches!(value, Value::String(_)), SchemaIssueKind::String),
        // `number` rejects `NaN` and the infinities. JSON has no `NaN`, and a
        // number past a double is the parser's error, so no text hands an
        // evaluator either: the test is the library's all the same
        SchemaNode::Number => (
            matches!(value, Value::Number(number) if number.is_finite()),
            SchemaIssueKind::Number,
        ),
        SchemaNode::Boolean => (matches!(value, Value::Bool(_)), SchemaIssueKind::Boolean),
        // JSON holds no bigint
        SchemaNode::Bigint => (false, SchemaIssueKind::Bigint),
        // `rest` reports the one value it refuses, as a missing key
        SchemaNode::Unknown => return Ok(()),
        SchemaNode::Literal(literal) => (literal.matches(value), SchemaIssueKind::Literal),
        SchemaNode::OneOf(literals) => (
            literals.iter().any(|literal| literal.matches(value)),
            SchemaIssueKind::OneOf,
        ),
        // a length action follows a string or an array, and a number action
        // is never true of anything but a number
        SchemaNode::MinLength(min) => (
            length(value).is_some_and(|length| length >= *min),
            SchemaIssueKind::MinLength,
        ),
        SchemaNode::MaxLength(max) => (
            length(value).is_some_and(|length| length <= *max),
            SchemaIssueKind::MaxLength,
        ),
        SchemaNode::MinValue(min) => (
            matches!(value, Value::Number(number) if number >= *min),
            SchemaIssueKind::MinValue,
        ),
        SchemaNode::MaxValue(max) => (
            matches!(value, Value::Number(number) if number <= *max),
            SchemaIssueKind::MaxValue,
        ),
        SchemaNode::Integer => (
            matches!(value, Value::Number(number) if js::is_integer(number)),
            SchemaIssueKind::Integer,
        ),
        SchemaNode::SafeInteger => (
            matches!(value, Value::Number(number) if js::is_safe_integer(number)),
            SchemaIssueKind::SafeInteger,
        ),
        // the format tests follow a string, and are never true of anything else
        SchemaNode::Uuid => (
            matches!(value, Value::String(text) if format::is_uuid(text)),
            SchemaIssueKind::Uuid,
        ),
        SchemaNode::IsoDatetime => (
            matches!(value, Value::String(text) if format::is_iso_datetime(text)),
            SchemaIssueKind::IsoDatetime,
        ),
        // `run` steps through these, and `rest` holds the containers
        SchemaNode::Optional(_)
        | SchemaNode::Nullable(_)
        | SchemaNode::WithDefault(_)
        | SchemaNode::Lazy(_)
        | SchemaNode::Union(_)
        | SchemaNode::Object(_)
        | SchemaNode::LooseObject(_)
        | SchemaNode::StripObject(_)
        | SchemaNode::Record(_)
        | SchemaNode::Array(_)
        | SchemaNode::Variant(_)
        | SchemaNode::Pipe(_)
        // `pipe` steps through it, the one place `build` lets it be
        | SchemaNode::ToLowerCase => unreachable!("`scalar` is handed a `{}`", node.kind()),
    };
    if matched { Ok(()) } else { Err(kind) }
}

/// The `length` of a string or an array.
fn length(value: Value<'_>) -> Option<f64> {
    match value {
        Value::String(text) => Some(js::length_number(js::utf16_len(text))),
        Value::Array(items) => Some(js::length_number(items.len())),
        _ => None,
    }
}

/// The three object schemas, by the kind of their issues: the entries in the
/// schema's order, each reading a missing key as `undefined`, then for an
/// `object` the input's keys.
///
/// `Value::Undefined` is a missing key and nothing else, as JSON has no
/// `undefined`. So an `unknown` that is given one refuses it, which is the
/// library's `unknown` handed the object and finding no key: as the entry
/// itself, and through the `nullable`, `lazy`, and `union` that pass the
/// object on. An `optional` and a `with_default` take it before it gets there.
fn object<R: Report>(
    schema: &Schema,
    id: NodeId,
    entries: &SchemaEntries,
    kind: SchemaIssueKind,
    value: Value<'_>,
    report: &mut R,
) -> bool {
    let Value::Object(fields) = value else {
        return fail(id, kind, value, report);
    };
    let mut matched = true;
    for (key, entry) in entries.iter() {
        let field = fields.get(key);
        let count = report.count();
        let value = field.map_or(Value::Undefined, Json::view);
        if !run(schema, entry, value, report) {
            if R::PROBE {
                return false;
            }
            report.prefix(count, Segment::Key(key));
            matched = false;
        }
    }
    // only an `object` refuses a key it has no entry for
    if kind == SchemaIssueKind::Object {
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
        return fail(id, SchemaIssueKind::Record, value, report);
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
        return fail(id, SchemaIssueKind::Array, value, report);
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
pub mod tests;
