//! The schema model: an arena of nodes, one per schema or action.
//!
//! The kinds are those of the TypeScript library's `SchemaDefs` contract that
//! can be carried across: everything but `regex`, `check`, and `transform`,
//! which hold JavaScript values.

use std::fmt;

use crate::bits::Bits;
use crate::js;
use crate::json::{Json, LINEAR_MAX, Value};

/// The most wrappers, `lazy`, `union` options, and starts of a `pipe` that
/// may be around one value.
///
/// Each is a step the evaluators take without reading into the input, so this
/// bounds how deep they recurse per level of the input. It does not bound the
/// work: a `union` whose options each come back to it tries every one at
/// every level.
pub const MAX_NESTING: usize = 16;

/// A node of a schema: an index into its arena.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId(u32);

impl NodeId {
    /// The target of a `lazy` that has not been defined.
    pub(crate) const UNDEFINED: Self = Self(u32::MAX);

    /// The id of the node at `index`. An index past what an id holds becomes
    /// `UNDEFINED`, and `build` refuses a schema that large.
    pub(crate) fn new(index: usize) -> Self {
        Self(u32::try_from(index).unwrap_or(u32::MAX))
    }

    pub(crate) const fn index(self) -> usize {
        self.0 as usize
    }
}

/// The kind of a node, named as the TypeScript library names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum SchemaKind {
    /// `string`.
    String,
    /// `number`.
    Number,
    /// `boolean`.
    Boolean,
    /// `bigint`.
    Bigint,
    /// `unknown`.
    Unknown,
    /// `literal`.
    Literal,
    /// `one_of`.
    OneOf,
    /// `optional`.
    Optional,
    /// `nullable`.
    Nullable,
    /// `with_default`.
    WithDefault,
    /// `lazy`.
    Lazy,
    /// `object`.
    Object,
    /// `loose_object`.
    LooseObject,
    /// `strip_object`.
    StripObject,
    /// `record`.
    Record,
    /// `array`.
    Array,
    /// `union`.
    Union,
    /// `variant`.
    Variant,
    /// `pipe`.
    Pipe,
    /// `min_length`.
    MinLength,
    /// `max_length`.
    MaxLength,
    /// `min_value`.
    MinValue,
    /// `max_value`.
    MaxValue,
    /// `integer`.
    Integer,
    /// `safe_integer`.
    SafeInteger,
}

impl SchemaKind {
    /// Every kind.
    pub const ALL: &'static [Self] = &[
        Self::String,
        Self::Number,
        Self::Boolean,
        Self::Bigint,
        Self::Unknown,
        Self::Literal,
        Self::OneOf,
        Self::Optional,
        Self::Nullable,
        Self::WithDefault,
        Self::Lazy,
        Self::Object,
        Self::LooseObject,
        Self::StripObject,
        Self::Record,
        Self::Array,
        Self::Union,
        Self::Variant,
        Self::Pipe,
        Self::MinLength,
        Self::MaxLength,
        Self::MinValue,
        Self::MaxValue,
        Self::Integer,
        Self::SafeInteger,
    ];

    /// The kind's name, the `kind` of the TypeScript schema.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Number => "number",
            Self::Boolean => "boolean",
            Self::Bigint => "bigint",
            Self::Unknown => "unknown",
            Self::Literal => "literal",
            Self::OneOf => "one_of",
            Self::Optional => "optional",
            Self::Nullable => "nullable",
            Self::WithDefault => "with_default",
            Self::Lazy => "lazy",
            Self::Object => "object",
            Self::LooseObject => "loose_object",
            Self::StripObject => "strip_object",
            Self::Record => "record",
            Self::Array => "array",
            Self::Union => "union",
            Self::Variant => "variant",
            Self::Pipe => "pipe",
            Self::MinLength => "min_length",
            Self::MaxLength => "max_length",
            Self::MinValue => "min_value",
            Self::MaxValue => "max_value",
            Self::Integer => "integer",
            Self::SafeInteger => "safe_integer",
        }
    }

    /// The kind named `name`.
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|kind| kind.as_str() == name)
    }

    /// Whether the kind is an action: a check of a value whose type an
    /// earlier step of a `pipe` has fixed.
    pub const fn is_action(self) -> bool {
        matches!(
            self,
            Self::MinLength
                | Self::MaxLength
                | Self::MinValue
                | Self::MaxValue
                | Self::Integer
                | Self::SafeInteger
        )
    }

    /// Whether the kind is an action that only means something in a `pipe`.
    /// The number tests answer for any value and stand alone.
    pub(crate) const fn needs_pipe(self) -> bool {
        matches!(
            self,
            Self::MinLength | Self::MaxLength | Self::MinValue | Self::MaxValue
        )
    }
}

impl fmt::Display for SchemaKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A value a `literal` or `one_of` matches by JavaScript's `===`.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum SchemaLiteral {
    /// `null`.
    Null,
    /// `true` or `false`.
    Boolean(bool),
    /// A number, which must be finite. `0` matches `-0`.
    Number(f64),
    /// A string.
    String(Box<str>),
}

impl SchemaLiteral {
    pub(crate) fn matches(&self, value: Value<'_>) -> bool {
        match (self, value) {
            (Self::Null, Value::Null) => true,
            (Self::Boolean(a), Value::Bool(b)) => *a == b,
            (Self::Number(a), Value::Number(b)) => js::number_equals(*a, b),
            (Self::String(a), Value::String(b)) => **a == *b,
            _ => false,
        }
    }

    pub(crate) const fn is_finite(&self) -> bool {
        match self {
            Self::Number(number) => number.is_finite(),
            _ => true,
        }
    }
}

impl From<bool> for SchemaLiteral {
    fn from(value: bool) -> Self {
        Self::Boolean(value)
    }
}

impl From<f64> for SchemaLiteral {
    fn from(value: f64) -> Self {
        Self::Number(value)
    }
}

impl From<i32> for SchemaLiteral {
    fn from(value: i32) -> Self {
        Self::Number(f64::from(value))
    }
}

impl From<&str> for SchemaLiteral {
    fn from(value: &str) -> Self {
        Self::String(value.into())
    }
}

impl From<String> for SchemaLiteral {
    fn from(value: String) -> Self {
        Self::String(value.into_boxed_str())
    }
}

/// A node: a schema or action and what its `def` holds.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum SchemaNode {
    /// Matches a string.
    String,
    /// Matches a finite number. No JSON text holds another: one past a
    /// double is an error of the parser.
    Number,
    /// Matches a boolean.
    Boolean,
    /// Matches a bigint, which JSON never holds.
    Bigint,
    /// Matches anything, and needs the key of the entry it is reached from:
    /// as the entry itself, and under a `nullable`, a `lazy`, or a `union`.
    Unknown,
    /// Matches one value.
    Literal(SchemaLiteral),
    /// Matches any of the values.
    OneOf(Box<[SchemaLiteral]>),
    /// Accepts a missing key, or matches the schema.
    Optional(NodeId),
    /// Accepts `null`, or matches the schema.
    Nullable(NodeId),
    /// Accepts a missing key, or matches the schema.
    WithDefault(Box<WithDefaultDef>),
    /// Defers to the schema, which is how a schema refers to itself.
    Lazy(NodeId),
    /// Matches an object with the entries and no other key.
    Object(Box<SchemaEntries>),
    /// Matches an object with the entries, whatever other keys it has.
    LooseObject(Box<SchemaEntries>),
    /// Matches an object with the entries, whatever other keys it has. It
    /// differs from `LooseObject` in the output, which a verdict has none of.
    StripObject(Box<SchemaEntries>),
    /// Matches an object whose values all match the schema.
    Record(NodeId),
    /// Matches an array whose items all match the schema.
    Array(NodeId),
    /// Matches when any of the options does, tried in order.
    Union(Box<[NodeId]>),
    /// Matches the option whose discriminator equals the value's.
    Variant(Box<VariantDef>),
    /// Matches when every step does, in order: a schema, then actions.
    Pipe(Box<[NodeId]>),
    /// A string or array at least this long. A string's length is in UTF-16
    /// code units.
    MinLength(f64),
    /// A string or array at most this long.
    MaxLength(f64),
    /// A number at least this.
    MinValue(f64),
    /// A number at most this.
    MaxValue(f64),
    /// A number with no fraction.
    Integer,
    /// An integer every neighbor of which is a distinct double.
    SafeInteger,
}

impl SchemaNode {
    /// The node's kind.
    pub const fn kind(&self) -> SchemaKind {
        match self {
            Self::String => SchemaKind::String,
            Self::Number => SchemaKind::Number,
            Self::Boolean => SchemaKind::Boolean,
            Self::Bigint => SchemaKind::Bigint,
            Self::Unknown => SchemaKind::Unknown,
            Self::Literal(_) => SchemaKind::Literal,
            Self::OneOf(_) => SchemaKind::OneOf,
            Self::Optional(_) => SchemaKind::Optional,
            Self::Nullable(_) => SchemaKind::Nullable,
            Self::WithDefault(_) => SchemaKind::WithDefault,
            Self::Lazy(_) => SchemaKind::Lazy,
            Self::Object(_) => SchemaKind::Object,
            Self::LooseObject(_) => SchemaKind::LooseObject,
            Self::StripObject(_) => SchemaKind::StripObject,
            Self::Record(_) => SchemaKind::Record,
            Self::Array(_) => SchemaKind::Array,
            Self::Union(_) => SchemaKind::Union,
            Self::Variant(_) => SchemaKind::Variant,
            Self::Pipe(_) => SchemaKind::Pipe,
            Self::MinLength(_) => SchemaKind::MinLength,
            Self::MaxLength(_) => SchemaKind::MaxLength,
            Self::MinValue(_) => SchemaKind::MinValue,
            Self::MaxValue(_) => SchemaKind::MaxValue,
            Self::Integer => SchemaKind::Integer,
            Self::SafeInteger => SchemaKind::SafeInteger,
        }
    }

    /// The entries of an object schema.
    pub(crate) fn entries(&self) -> Option<&SchemaEntries> {
        match self {
            Self::Object(entries) | Self::LooseObject(entries) | Self::StripObject(entries) => {
                Some(entries)
            }
            _ => None,
        }
    }

    /// The nodes this one steps to without reading into the value.
    pub(crate) fn nesting(&self) -> &[NodeId] {
        match self {
            Self::Optional(schema) | Self::Nullable(schema) | Self::Lazy(schema) => {
                std::slice::from_ref(schema)
            }
            Self::WithDefault(default) => std::slice::from_ref(&default.schema),
            Self::Union(options) => options,
            Self::Pipe(steps) => steps.get(..1).unwrap_or_default(),
            _ => &[],
        }
    }
}

/// What a `with_default` holds.
#[derive(Debug, Clone, PartialEq)]
pub struct WithDefaultDef {
    pub(crate) schema: NodeId,
    pub(crate) value: Json,
}

impl WithDefaultDef {
    /// The schema a present value must match.
    pub const fn schema(&self) -> NodeId {
        self.schema
    }

    /// The value a missing key is given in the output. It is never validated.
    pub const fn value(&self) -> &Json {
        &self.value
    }
}

/// The entries of an object schema, in the order they run: the order the
/// keys were given in, with array indices first, as JavaScript orders them.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SchemaEntries {
    pub(crate) keys: Box<[Box<str>]>,
    pub(crate) schemas: Box<[NodeId]>,
    /// The positions sorted by key, empty for a small object.
    sorted: Box<[usize]>,
    /// The entries that reject a missing key.
    pub(crate) required: Bits,
}

impl SchemaEntries {
    pub(crate) fn new(entries: Vec<(Box<str>, NodeId)>) -> Self {
        let (keys, schemas): (Vec<_>, Vec<_>) = entries.into_iter().unzip();
        Self {
            keys: keys.into_boxed_slice(),
            schemas: schemas.into_boxed_slice(),
            sorted: Box::default(),
            required: Bits::default(),
        }
    }

    /// Puts the entries in JavaScript's order and builds the lookup index.
    pub(crate) fn finish(&mut self) {
        let keys = std::mem::take(&mut self.keys).into_vec();
        let schemas = std::mem::take(&mut self.schemas).into_vec();
        *self = Self::new(js::key_order(keys.into_iter().zip(schemas).collect()));
        if self.keys.len() > LINEAR_MAX {
            let mut sorted: Vec<usize> = (0..self.keys.len()).collect();
            sorted.sort_unstable_by(|&a, &b| self.keys[a].cmp(&self.keys[b]));
            self.sorted = sorted.into_boxed_slice();
        }
        self.required = Bits::new(self.keys.len());
    }

    /// The number of entries.
    pub const fn len(&self) -> usize {
        self.keys.len()
    }

    /// Whether there are no entries.
    pub const fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// The schema of the entry at `key`.
    pub fn get(&self, key: &str) -> Option<NodeId> {
        self.position(key).map(|position| self.schemas[position])
    }

    /// The keys and their schemas, in the order they run.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = (&str, NodeId)> {
        self.keys
            .iter()
            .zip(&self.schemas)
            .map(|(key, &schema)| (&**key, schema))
    }

    /// Where the entry at `key` is in the order.
    pub(crate) fn position(&self, key: &str) -> Option<usize> {
        if self.sorted.is_empty() {
            self.keys.iter().position(|k| &**k == key)
        } else {
            self.sorted
                .binary_search_by(|&position| (*self.keys[position]).cmp(key))
                .ok()
                .map(|found| self.sorted[found])
        }
    }

    /// Like `position`, trying `hint` first: input written in the schema's
    /// order is found without a search.
    pub(crate) fn position_from(&self, hint: usize, key: &str) -> Option<usize> {
        if self.keys.get(hint).is_some_and(|k| &**k == key) {
            Some(hint)
        } else {
            self.position(key)
        }
    }

    pub(crate) fn schema_at(&self, position: usize) -> NodeId {
        self.schemas[position]
    }

    /// The entries that reject a missing key.
    pub(crate) const fn required(&self) -> &Bits {
        &self.required
    }
}

/// What a `variant` holds.
#[derive(Debug, Clone, PartialEq)]
pub struct VariantDef {
    pub(crate) key: Box<str>,
    pub(crate) options: Box<[NodeId]>,
    /// Each discriminator value and the option it selects, in the order the
    /// values first appear. A value given twice selects the later option, as
    /// the TypeScript library's `Map` does.
    pub(crate) table: Box<[(SchemaLiteral, NodeId)]>,
}

impl VariantDef {
    /// The discriminator: the key whose value selects the option.
    pub fn key(&self) -> &str {
        &self.key
    }

    /// The options, each an object schema with a `literal` entry at the key.
    pub fn options(&self) -> &[NodeId] {
        &self.options
    }

    /// The option `value` selects, as the value at the discriminator.
    pub(crate) fn select(&self, value: Value<'_>) -> Option<NodeId> {
        // TODO: index the strings when there are many options
        self.table
            .iter()
            .find(|(literal, _)| literal.matches(value))
            .map(|&(_, option)| option)
    }
}

/// An array or an object: what a `union` is asked about before one is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    Array,
    Object,
}

/// The options of a `union` that an array, or an object, could match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Candidates {
    /// No option, so the union matches none.
    None,
    /// This option and no other, so the union matches what it matches.
    One(NodeId),
    /// More than one, so which is not known until the value is whole.
    Many,
}

/// A schema: an arena of nodes and the one validation starts at.
///
/// Made by `SchemaBuilder`, or loaded from the interchange form with
/// `Schema::from_json`. It owns everything it refers to, holds no interior
/// state, and can be shared between threads.
#[derive(Debug, Clone, PartialEq)]
pub struct Schema {
    pub(crate) nodes: Box<[SchemaNode]>,
    pub(crate) root: NodeId,
    /// Whether each node accepts every value that is present, so that the
    /// value need not be read.
    pub(crate) any: Box<[bool]>,
    /// For each `union`, its candidates for an array and for an object. Any
    /// other node has none.
    pub(crate) candidates: Box<[[Candidates; 2]]>,
}

impl Schema {
    /// The node validation starts at.
    pub const fn root(&self) -> NodeId {
        self.root
    }

    /// The node with `id`, when `id` is one of this schema's.
    pub fn node(&self, id: NodeId) -> Option<&SchemaNode> {
        self.nodes.get(id.index())
    }

    /// The node with `id`, which must be one this schema's nodes refer to.
    pub(crate) fn at(&self, id: NodeId) -> &SchemaNode {
        &self.nodes[id.index()]
    }

    /// Every node, in no order that means anything. All but those a builder
    /// was given and never used are reachable from the root.
    pub fn nodes(&self) -> impl ExactSizeIterator<Item = &SchemaNode> {
        self.nodes.iter()
    }

    /// Whether the node accepts every value that is present.
    pub(crate) fn accepts_any(&self, id: NodeId) -> bool {
        self.any[id.index()]
    }

    /// The options of the `union` with `id` that `container` could match.
    pub(crate) fn candidates(&self, id: NodeId, container: Container) -> Candidates {
        self.candidates[id.index()][container as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builder::SchemaBuilder;
    use crate::json::Json;

    fn built(build: impl FnOnce(&mut SchemaBuilder) -> NodeId) -> Schema {
        let mut builder = SchemaBuilder::new();
        let root = build(&mut builder);
        builder.build(root).unwrap()
    }

    #[test]
    fn kinds_have_distinct_names_that_read_back() {
        for &kind in SchemaKind::ALL {
            assert_eq!(SchemaKind::from_name(kind.as_str()), Some(kind));
            assert_eq!(kind.to_string(), kind.as_str());
        }
        let mut names: Vec<&str> = SchemaKind::ALL.iter().map(|kind| kind.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), SchemaKind::ALL.len());
        for name in ["regex", "check", "transform", "", "String"] {
            assert_eq!(SchemaKind::from_name(name), None);
        }
    }

    /// The place of each kind in `SchemaKind::ALL`. Every one is named, so a new
    /// one does not compile until it is given a place here, which the test
    /// then asks `ALL` for.
    const fn place(kind: SchemaKind) -> usize {
        match kind {
            SchemaKind::String => 0,
            SchemaKind::Number => 1,
            SchemaKind::Boolean => 2,
            SchemaKind::Bigint => 3,
            SchemaKind::Unknown => 4,
            SchemaKind::Literal => 5,
            SchemaKind::OneOf => 6,
            SchemaKind::Optional => 7,
            SchemaKind::Nullable => 8,
            SchemaKind::WithDefault => 9,
            SchemaKind::Lazy => 10,
            SchemaKind::Object => 11,
            SchemaKind::LooseObject => 12,
            SchemaKind::StripObject => 13,
            SchemaKind::Record => 14,
            SchemaKind::Array => 15,
            SchemaKind::Union => 16,
            SchemaKind::Variant => 17,
            SchemaKind::Pipe => 18,
            SchemaKind::MinLength => 19,
            SchemaKind::MaxLength => 20,
            SchemaKind::MinValue => 21,
            SchemaKind::MaxValue => 22,
            SchemaKind::Integer => 23,
            SchemaKind::SafeInteger => 24,
        }
    }

    #[test]
    fn every_kind_is_listed_at_its_place() {
        for (index, &kind) in SchemaKind::ALL.iter().enumerate() {
            assert_eq!(place(kind), index, "{kind}");
        }
        // the last place is the last of the list, so none is past its end
        assert_eq!(place(SchemaKind::SafeInteger) + 1, SchemaKind::ALL.len());
    }

    #[test]
    fn a_schema_is_shared_between_threads() {
        const fn shared<T: Send + Sync>() {}
        shared::<Schema>();
    }

    #[test]
    fn nodes_are_read_back() {
        let mut builder = SchemaBuilder::new();
        let name = builder.string();
        let age = builder.number();
        let person = builder.object([("name", name), ("age", age)]);
        let schema = builder.build(person).unwrap();
        assert_eq!(schema.root(), person);
        let Some(SchemaNode::Object(entries)) = schema.node(person) else {
            panic!("not an object");
        };
        assert_eq!(entries.len(), 2);
        assert!(!entries.is_empty());
        assert_eq!(entries.get("name"), Some(name));
        assert_eq!(entries.get("missing"), None);
        assert_eq!(
            entries.iter().collect::<Vec<_>>(),
            [("name", name), ("age", age)]
        );
        assert_eq!(
            schema.node(name).map(SchemaNode::kind),
            Some(SchemaKind::String)
        );
        assert_eq!(schema.node(NodeId::new(99)), None);
    }

    #[test]
    fn entries_run_in_javascript_order() {
        let schema = built(|b| {
            let s = b.string();
            b.object([("b", s), ("10", s), ("a", s), ("2", s), ("01", s)])
        });
        let entries = schema.at(schema.root()).entries().unwrap();
        let keys: Vec<&str> = entries.iter().map(|(key, _)| key).collect();
        assert_eq!(keys, ["2", "10", "b", "a", "01"]);
    }

    #[test]
    fn many_entries_are_found_through_the_index() {
        let mut builder = SchemaBuilder::new();
        let string = builder.string();
        let optional = builder.optional(string);
        let keys: Vec<String> = (0..100).map(|i| format!("k{i}")).collect();
        let object = builder.object(keys.iter().map(|key| {
            (
                key.as_str(),
                if key.ends_with('0') { optional } else { string },
            )
        }));
        let schema = builder.build(object).unwrap();
        let entries = schema.at(object).entries().unwrap();
        for (position, key) in keys.iter().enumerate() {
            assert_eq!(entries.position(key), Some(position));
            assert_eq!(entries.position_from(position, key), Some(position));
            assert_eq!(entries.position_from(0, key), Some(position));
            assert_eq!(entries.position_from(1000, key), Some(position));
            assert_eq!(entries.required().contains(position), !key.ends_with('0'));
        }
        assert_eq!(entries.position("k100"), None);
        assert_eq!(entries.position_from(3, "nope"), None);
    }

    #[test]
    fn required_entries_are_those_a_missing_key_fails() {
        let schema = built(|b| {
            let string = b.string();
            let unknown = b.unknown();
            let optional = b.optional(string);
            let nullable = b.nullable(string);
            let default = b.with_default(string, Json::Null);
            let nested = b.nullable(optional);
            let either = b.union([string, optional]);
            let held = b.nullable(unknown);
            let option = b.union([string, unknown]);
            let deferred = b.declare();
            b.define(deferred, unknown);
            let optional_unknown = b.optional(unknown);
            let both = b.union([unknown, nullable]);
            let unknown_or_optional = b.union([unknown, optional]);
            let held_optional = b.nullable(optional_unknown);
            b.loose_object([
                ("string", string),
                ("unknown", unknown),
                ("optional", optional),
                ("nullable", nullable),
                ("default", default),
                ("nested", nested),
                ("either", either),
                ("held", held),
                ("option", option),
                ("deferred", deferred),
                ("optional_unknown", optional_unknown),
                ("both", both),
                ("unknown_or_optional", unknown_or_optional),
                ("held_optional", held_optional),
            ])
        });
        let entries = schema.at(schema.root()).entries().unwrap();
        let required: Vec<&str> = entries
            .iter()
            .enumerate()
            .filter(|&(position, _)| entries.required().contains(position))
            .map(|(_, (key, _))| key)
            .collect();
        // an `unknown` needs its key wherever the entry reaches it, and an
        // `optional` on the way, or beside it in a `union`, lets the key be
        // missing
        assert_eq!(
            required,
            [
                "string", "unknown", "nullable", "held", "option", "deferred", "both"
            ]
        );
    }

    #[test]
    fn accepts_any_follows_wrappers_and_unions() {
        let mut b = SchemaBuilder::new();
        let unknown = b.unknown();
        let string = b.string();
        let optional_unknown = b.optional(unknown);
        let nullable_string = b.nullable(string);
        let either = b.union([string, optional_unknown]);
        let neither = b.union([string, nullable_string]);
        let lazy = b.declare();
        b.define(lazy, unknown);
        let root = b.object([
            ("a", unknown),
            ("b", optional_unknown),
            ("c", nullable_string),
            ("d", either),
            ("e", neither),
            ("f", lazy),
        ]);
        let schema = b.build(root).unwrap();
        for (id, any) in [
            (unknown, true),
            (string, false),
            (optional_unknown, true),
            (nullable_string, false),
            (either, true),
            (neither, false),
            (lazy, true),
            (root, false),
        ] {
            assert_eq!(schema.accepts_any(id), any, "{:?}", schema.at(id));
        }
    }

    #[test]
    fn a_union_knows_the_options_a_container_could_match() {
        use Candidates::{Many, One};
        const NONE: Candidates = Candidates::None;
        let mut b = SchemaBuilder::new();
        let string = b.string();
        let number = b.number();
        let null = b.literal(SchemaLiteral::Null);
        let unknown = b.unknown();
        let strings = b.array(string);
        let numbers = b.array(number);
        let object = b.object([("a", number)]);
        let loose = b.loose_object([("a", number)]);
        let strip = b.strip_object([("a", number)]);
        let record = b.record(number);
        let tag = b.literal("t");
        let tagged = b.object([("k", tag)]);
        let variant = b.variant("k", [tagged]);
        // what is looked through
        let optional = b.optional(strings);
        let nullable = b.nullable(object);
        let default = b.with_default(record, Json::Null);
        let min = b.min_length(1.0);
        let piped = b.pipe([numbers, min]);
        let piped_twice = b.pipe([piped, min]);
        let long = b.pipe([string, min]);
        let lazy = b.declare();
        let lazier = b.declare();
        b.define(lazy, lazier);
        b.define(lazier, strings);
        let scalars = b.union([string, number, null, long]);
        let inner = b.union([null, numbers]);
        // a union that comes back to itself through its containers
        let json = b.declare();
        let items = b.array(json);
        let fields = b.record(json);
        let any = b.union([null, string, items, fields]);
        b.define(json, any);
        let cases: Vec<(Vec<NodeId>, Candidates, Candidates)> = vec![
            (vec![], NONE, NONE),
            (vec![string, number, null, long], NONE, NONE),
            (vec![string, strings], One(strings), NONE),
            (vec![null, object], NONE, One(object)),
            (vec![strings, object], One(strings), One(object)),
            (vec![strings, numbers], Many, NONE),
            (vec![strings, strings], Many, NONE),
            (vec![object, record], NONE, Many),
            (vec![loose, strip], NONE, Many),
            (vec![object, variant], NONE, Many),
            (vec![string, variant], NONE, One(variant)),
            (vec![string, loose], NONE, One(loose)),
            (vec![strip, numbers], One(numbers), One(strip)),
            (vec![string, optional], One(optional), NONE),
            (vec![nullable, number], NONE, One(nullable)),
            (vec![default, strings], One(strings), One(default)),
            (vec![piped_twice, null], One(piped_twice), NONE),
            (vec![long, piped], One(piped), NONE),
            (vec![lazy, object], One(lazy), One(object)),
            (vec![lazy, numbers], Many, NONE),
            (vec![string, inner], One(inner), NONE),
            (vec![inner, strings], Many, NONE),
            (vec![scalars, object], NONE, One(object)),
            (vec![scalars, inner, nullable], One(inner), One(nullable)),
            (vec![unknown, strings], Many, One(unknown)),
            (vec![unknown, object, strings], Many, Many),
            (vec![json, number], One(json), One(json)),
        ];
        let unions: Vec<NodeId> = cases
            .iter()
            .map(|(options, ..)| b.union(options.iter().copied()))
            .collect();
        let root = b.union(unions.iter().copied());
        let schema = b.build(root).unwrap();
        for (&union, (options, array, object)) in unions.iter().zip(&cases) {
            let found = [Container::Array, Container::Object].map(|c| schema.candidates(union, c));
            assert_eq!(found, [*array, *object], "{options:?}");
        }
        assert_eq!(
            [Container::Array, Container::Object].map(|c| schema.candidates(any, c)),
            [One(items), One(fields)]
        );
        // only a union has any
        for id in [
            string, strings, object, optional, lazy, piped, variant, unknown,
        ] {
            for container in [Container::Array, Container::Object] {
                assert_eq!(
                    schema.candidates(id, container),
                    NONE,
                    "{:?}",
                    schema.at(id)
                );
            }
        }
    }

    #[test]
    fn a_variant_selects_by_its_table() {
        let mut b = SchemaBuilder::new();
        let a = b.literal("a");
        let one = b.literal(1);
        let zero = b.literal(0.0);
        let negative_zero = b.literal(-0.0);
        let null = b.literal(SchemaLiteral::Null);
        let yes = b.literal(true);
        let first = b.object([("k", a)]);
        let second = b.loose_object([("k", one)]);
        let third = b.strip_object([("k", a)]);
        let fourth = b.object([("k", zero)]);
        let fifth = b.object([("k", negative_zero)]);
        let sixth = b.object([("k", null)]);
        let seventh = b.object([("k", yes)]);
        let variant = b.variant("k", [first, second, third, fourth, fifth, sixth, seventh]);
        let schema = b.build(variant).unwrap();
        let SchemaNode::Variant(def) = schema.at(variant) else {
            panic!("not a variant");
        };
        assert_eq!(def.key(), "k");
        assert_eq!(def.options().len(), 7);
        // a value given twice selects the later option, at the first position
        assert_eq!(
            def.table
                .iter()
                .map(|(_, option)| *option)
                .collect::<Vec<_>>(),
            [third, second, fifth, sixth, seventh]
        );
        assert_eq!(def.select(Value::String("a")), Some(third));
        assert_eq!(def.select(Value::Number(1.0)), Some(second));
        assert_eq!(def.select(Value::Number(0.0)), Some(fifth));
        assert_eq!(def.select(Value::Number(-0.0)), Some(fifth));
        assert_eq!(def.select(Value::Null), Some(sixth));
        assert_eq!(def.select(Value::Bool(true)), Some(seventh));
        assert_eq!(def.select(Value::Bool(false)), None);
        assert_eq!(def.select(Value::String("1")), None);
        assert_eq!(def.select(Value::Undefined), None);
        assert_eq!(def.select(Value::Array(&[])), None);
    }
}
