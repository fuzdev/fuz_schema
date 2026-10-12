//! Issues: what the TypeScript library's `parse` reports of a value that
//! does not match, without the `message` a schema there can set.

use std::fmt;

use crate::json::Value;
use crate::schema::Kind;

/// A validation failure, as the TypeScript library's `SchemaIssue` has it.
///
/// It owns what it holds, and holds nothing of the input but the keys in its
/// path: the value that failed is described by `received` and not kept. Those
/// keys are the input's, so treat them as untrusted text.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Issue {
    pub(crate) kind: IssueKind,
    pub(crate) expected: String,
    pub(crate) received: Received,
    pub(crate) path: Vec<PathSegment>,
}

impl Issue {
    /// What failed: the kind of the schema or action, or `UnknownKey`.
    pub const fn kind(&self) -> IssueKind {
        self.kind
    }

    /// What was expected, in the TypeScript library's words.
    pub fn expected(&self) -> &str {
        &self.expected
    }

    /// The type of the value that failed.
    pub const fn received(&self) -> Received {
        self.received
    }

    /// The keys and indices from the root value to the one that failed,
    /// outermost first. Empty for the root.
    pub fn path(&self) -> &[PathSegment] {
        &self.path
    }
}

/// A step of an issue's path.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PathSegment {
    /// A key of an object, which the TypeScript library has as a string.
    Key(String),
    /// An index of an array, which the TypeScript library has as a number.
    Index(usize),
}

/// The type of a value that failed, as the TypeScript library names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum Received {
    /// `undefined`, which is what a missing key reads as.
    Undefined,
    /// `null`.
    Null,
    /// `boolean`.
    Boolean,
    /// `number`.
    Number,
    /// `string`.
    String,
    /// `array`.
    Array,
    /// `object`.
    Object,
}

impl Received {
    /// Every type a value of a JSON text, or a missing key, has.
    pub const ALL: &'static [Self] = &[
        Self::Undefined,
        Self::Null,
        Self::Boolean,
        Self::Number,
        Self::String,
        Self::Array,
        Self::Object,
    ];

    /// The type's name, the `received` of the TypeScript issue.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Undefined => "undefined",
            Self::Null => "null",
            Self::Boolean => "boolean",
            Self::Number => "number",
            Self::String => "string",
            Self::Array => "array",
            Self::Object => "object",
        }
    }

    pub(crate) const fn of(value: Value<'_>) -> Self {
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

impl fmt::Display for Received {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// What an issue is of: the kind of the schema or action that failed, or a
/// key an `object` has no entry for.
///
/// The kinds that never fail themselves have none: `unknown` accepts
/// everything, the wrappers, `lazy`, and `pipe` leave the failure to the
/// schema they hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum IssueKind {
    /// `string`.
    String,
    /// `number`.
    Number,
    /// `boolean`.
    Boolean,
    /// `bigint`.
    Bigint,
    /// `literal`.
    Literal,
    /// `one_of`.
    OneOf,
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
    /// `finite`.
    Finite,
    /// `unknown_key`: the value is at a key an `object` has no entry for.
    UnknownKey,
}

impl IssueKind {
    /// Every issue kind.
    pub const ALL: &'static [Self] = &[
        Self::String,
        Self::Number,
        Self::Boolean,
        Self::Bigint,
        Self::Literal,
        Self::OneOf,
        Self::Object,
        Self::LooseObject,
        Self::StripObject,
        Self::Record,
        Self::Array,
        Self::Union,
        Self::Variant,
        Self::MinLength,
        Self::MaxLength,
        Self::MinValue,
        Self::MaxValue,
        Self::Integer,
        Self::SafeInteger,
        Self::Finite,
        Self::UnknownKey,
    ];

    /// The kind's name, the `kind` of the TypeScript issue.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Number => "number",
            Self::Boolean => "boolean",
            Self::Bigint => "bigint",
            Self::Literal => "literal",
            Self::OneOf => "one_of",
            Self::Object => "object",
            Self::LooseObject => "loose_object",
            Self::StripObject => "strip_object",
            Self::Record => "record",
            Self::Array => "array",
            Self::Union => "union",
            Self::Variant => "variant",
            Self::MinLength => "min_length",
            Self::MaxLength => "max_length",
            Self::MinValue => "min_value",
            Self::MaxValue => "max_value",
            Self::Integer => "integer",
            Self::SafeInteger => "safe_integer",
            Self::Finite => "finite",
            Self::UnknownKey => "unknown_key",
        }
    }

    /// The issue kind of a schema of `kind` that fails, or `None` for a kind
    /// that never fails itself.
    pub const fn of(kind: Kind) -> Option<Self> {
        // every kind is named, so that a new one is decided here
        match kind {
            Kind::String => Some(Self::String),
            Kind::Number => Some(Self::Number),
            Kind::Boolean => Some(Self::Boolean),
            Kind::Bigint => Some(Self::Bigint),
            Kind::Literal => Some(Self::Literal),
            Kind::OneOf => Some(Self::OneOf),
            Kind::Object => Some(Self::Object),
            Kind::LooseObject => Some(Self::LooseObject),
            Kind::StripObject => Some(Self::StripObject),
            Kind::Record => Some(Self::Record),
            Kind::Array => Some(Self::Array),
            Kind::Union => Some(Self::Union),
            Kind::Variant => Some(Self::Variant),
            Kind::MinLength => Some(Self::MinLength),
            Kind::MaxLength => Some(Self::MaxLength),
            Kind::MinValue => Some(Self::MinValue),
            Kind::MaxValue => Some(Self::MaxValue),
            Kind::Integer => Some(Self::Integer),
            Kind::SafeInteger => Some(Self::SafeInteger),
            Kind::Finite => Some(Self::Finite),
            Kind::Unknown
            | Kind::Optional
            | Kind::Nullable
            | Kind::Default
            | Kind::Lazy
            | Kind::Pipe => None,
        }
    }
}

impl fmt::Display for IssueKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_kinds_have_distinct_names() {
        let mut names: Vec<&str> = IssueKind::ALL.iter().map(|kind| kind.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), IssueKind::ALL.len());
        for &kind in IssueKind::ALL {
            assert_eq!(kind.to_string(), kind.as_str());
        }
    }

    /// The place of each issue kind in `IssueKind::ALL`. Every one is named,
    /// so a new one does not compile until it is given a place here, which
    /// the test then asks `ALL` for.
    const fn place(kind: IssueKind) -> usize {
        match kind {
            IssueKind::String => 0,
            IssueKind::Number => 1,
            IssueKind::Boolean => 2,
            IssueKind::Bigint => 3,
            IssueKind::Literal => 4,
            IssueKind::OneOf => 5,
            IssueKind::Object => 6,
            IssueKind::LooseObject => 7,
            IssueKind::StripObject => 8,
            IssueKind::Record => 9,
            IssueKind::Array => 10,
            IssueKind::Union => 11,
            IssueKind::Variant => 12,
            IssueKind::MinLength => 13,
            IssueKind::MaxLength => 14,
            IssueKind::MinValue => 15,
            IssueKind::MaxValue => 16,
            IssueKind::Integer => 17,
            IssueKind::SafeInteger => 18,
            IssueKind::Finite => 19,
            IssueKind::UnknownKey => 20,
        }
    }

    #[test]
    fn every_issue_kind_is_listed_at_its_place() {
        for (index, &kind) in IssueKind::ALL.iter().enumerate() {
            assert_eq!(place(kind), index, "{kind}");
        }
        // the last place is the last of the list, so none is past its end
        assert_eq!(place(IssueKind::UnknownKey) + 1, IssueKind::ALL.len());
    }

    #[test]
    fn a_kind_that_fails_has_the_issue_kind_of_its_name() {
        let mut found = Vec::new();
        for &kind in Kind::ALL {
            let never_fails = matches!(
                kind,
                Kind::Unknown
                    | Kind::Optional
                    | Kind::Nullable
                    | Kind::Default
                    | Kind::Lazy
                    | Kind::Pipe
            );
            match IssueKind::of(kind) {
                Some(issue_kind) => {
                    assert!(!never_fails, "{kind}");
                    assert_eq!(issue_kind.as_str(), kind.as_str());
                    found.push(issue_kind);
                }
                None => assert!(never_fails, "{kind}"),
            }
        }
        // and the one issue kind that is of no schema
        found.push(IssueKind::UnknownKey);
        assert_eq!(found, IssueKind::ALL);
        assert_eq!(Kind::from_name(IssueKind::UnknownKey.as_str()), None);
    }

    #[test]
    fn received_types_have_the_names_typeof_gives() {
        let names: Vec<&str> = Received::ALL.iter().map(|r| r.as_str()).collect();
        assert_eq!(
            names,
            [
                "undefined",
                "null",
                "boolean",
                "number",
                "string",
                "array",
                "object"
            ]
        );
        assert_eq!(Received::of(Value::Undefined), Received::Undefined);
        assert_eq!(Received::of(Value::Null), Received::Null);
        assert_eq!(Received::of(Value::Bool(false)), Received::Boolean);
        assert_eq!(Received::of(Value::Number(0.0)), Received::Number);
        assert_eq!(Received::of(Value::String("")), Received::String);
        assert_eq!(Received::of(Value::Array(&[])), Received::Array);
        assert_eq!(Received::of(Value::Array(&[])).to_string(), "array");
    }
}
