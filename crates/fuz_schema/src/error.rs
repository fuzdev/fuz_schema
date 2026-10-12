//! The crate's errors: `JsonError` for text that is not JSON this crate reads,
//! and `SchemaError` for a schema it refuses.

use std::error::Error;
use std::fmt;

use crate::schema::Kind;

/// Why a text could not be read as JSON.
///
/// The crate's own type, so what parses the text is not part of the API.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonError {
    kind: JsonErrorKind,
    line: usize,
    column: usize,
    message: Box<str>,
}

/// The reason for a `JsonError`: the first problem the parser met.
///
/// `NumberOutOfRange`, `LoneSurrogate`, and `DepthLimit` are what `JSON.parse`
/// reads and this crate does not. The kind is of the first problem and says
/// nothing of the rest of the text, so `1e400x` is `NumberOutOfRange` though
/// `JSON.parse` throws on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum JsonErrorKind {
    /// The text is not JSON.
    Syntax,
    /// The text ended inside a value.
    Eof,
    /// A number too large for a double, such as `1e400`, which `JSON.parse`
    /// reads as `Infinity`.
    NumberOutOfRange,
    /// A string with a `\u` escape of half a surrogate pair, such as
    /// `"\ud800"`, which `JSON.parse` keeps.
    LoneSurrogate,
    /// Arrays and objects nested deeper than `MAX_DEPTH`.
    DepthLimit,
    /// The bytes are not UTF-8.
    InvalidUtf8,
}

impl JsonError {
    pub(crate) fn from_serde(error: &serde_json::Error) -> Self {
        let message = error.to_string();
        // serde_json has no public code for these, only the text it writes
        let kind = if error.is_eof() {
            JsonErrorKind::Eof
        } else if message.starts_with("number out of range") {
            JsonErrorKind::NumberOutOfRange
        } else if message.starts_with("lone leading surrogate")
            || message.starts_with("unexpected end of hex escape")
        {
            JsonErrorKind::LoneSurrogate
        } else if message.starts_with("recursion limit exceeded") {
            JsonErrorKind::DepthLimit
        } else {
            JsonErrorKind::Syntax
        };
        Self {
            kind,
            line: error.line(),
            column: error.column(),
            message: message.into(),
        }
    }

    pub(crate) fn invalid_utf8(bytes: &[u8], error: std::str::Utf8Error) -> Self {
        let valid = &bytes[..error.valid_up_to()];
        let line_start = valid
            .iter()
            .rposition(|&byte| byte == b'\n')
            .map_or(0, |newline| newline + 1);
        let line = valid.split(|&byte| byte == b'\n').count();
        let column = valid.len() - line_start + 1;
        Self {
            kind: JsonErrorKind::InvalidUtf8,
            line,
            column,
            message: format!("invalid UTF-8 at line {line} column {column}").into(),
        }
    }

    /// The reason.
    pub const fn kind(&self) -> JsonErrorKind {
        self.kind
    }

    /// The line the error is on, from 1.
    pub const fn line(&self) -> usize {
        self.line
    }

    /// The byte in that line the error is at, from 1, or 0 before the line's
    /// first byte.
    pub const fn column(&self) -> usize {
        self.column
    }
}

impl fmt::Display for JsonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for JsonError {}

/// A schema this crate refuses, with where in the schema the reason is.
///
/// Nothing is guessed at: a schema whose meaning the TypeScript library gets
/// from JavaScript itself, such as a function, a `RegExp`, a coercion, or a
/// read through the prototype, is refused when it is built.
#[derive(Debug, Clone, PartialEq)]
pub struct SchemaError {
    kind: SchemaErrorKind,
    path: Box<str>,
}

impl SchemaError {
    pub(crate) fn new(kind: SchemaErrorKind, path: impl Into<Box<str>>) -> Self {
        Self {
            kind,
            path: path.into(),
        }
    }

    /// The reason.
    pub const fn kind(&self) -> &SchemaErrorKind {
        &self.kind
    }

    /// Where the reason is, as a JSON Pointer from the root, through the
    /// `def` of each schema on the way: `/schema/def/name` is the `name`
    /// entry of a root `object`, and `/defs/$0` is the target of the first
    /// `lazy` declared. Empty when the error is about the whole schema.
    pub fn path(&self) -> &str {
        &self.path
    }
}

/// The reason for a `SchemaError`.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum SchemaErrorKind {
    /// A number that is not finite, as a literal or a bound.
    NonFiniteNumber,
    /// An entry named like a member of `Object.prototype`, which the
    /// TypeScript library reads through the prototype.
    PrototypeKey {
        /// The entry's key.
        key: Box<str>,
    },
    /// Two entries of one object schema with the same key.
    DuplicateKey {
        /// The key.
        key: Box<str>,
    },
    /// A `pipe` with no schema.
    EmptyPipe,
    /// A `pipe` whose first schema does not fix the type of its value: only
    /// `string`, `number`, `array`, `integer`, `safe_integer`, `finite`, or a
    /// `pipe` of one of those can start a pipe.
    PipeHead {
        /// The kind found.
        kind: Kind,
    },
    /// A step of a `pipe` after the first that is not an action.
    PipeStep {
        /// The kind found.
        kind: Kind,
    },
    /// An action on a value it is not for: a length of a number, or a bound
    /// or number test of a string or array.
    ActionMismatch {
        /// The action.
        kind: Kind,
    },
    /// A length or bound action outside a `pipe`, where the TypeScript
    /// library would coerce or throw.
    ActionOutsidePipe {
        /// The action.
        kind: Kind,
    },
    /// A `variant` option that is not an object schema.
    VariantOption {
        /// The kind found.
        kind: Kind,
    },
    /// A `variant` option with no `literal` entry at the discriminator.
    VariantDiscriminator {
        /// The discriminator.
        key: Box<str>,
    },
    /// A `lazy` that was declared and never defined.
    UndefinedLazy,
    /// Two definitions of one `lazy`.
    RedefinedLazy,
    /// A schema that comes back to itself without reading into the value,
    /// through wrappers, `lazy`, `union` options, or the start of a `pipe`.
    UnguardedRecursion,
    /// More wrappers, `lazy`, `union` options, or starts of a `pipe` around
    /// one value than the evaluators follow.
    TooNested {
        /// The most that is followed.
        limit: usize,
    },
    /// A node id that is not one of the builder's.
    InvalidNode,
    /// The parser does not hand a number over as a number, so no schema is
    /// made. `serde_json` does not when its `arbitrary_precision` feature is
    /// on, which any crate of a build turns on for every crate of it.
    ArbitraryPrecision,
    /// More nodes than a schema holds.
    TooManyNodes,
}

impl fmt::Display for SchemaErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFiniteNumber => f.write_str("a number that is not finite"),
            Self::PrototypeKey { key } => write!(
                f,
                "the entry {key:?} is named like a member of Object.prototype"
            ),
            Self::DuplicateKey { key } => write!(f, "the entry {key:?} is given twice"),
            Self::EmptyPipe => f.write_str("a pipe with no schema"),
            Self::PipeHead { kind } => write!(
                f,
                "a pipe cannot start with `{kind}`, which does not fix the type of its value"
            ),
            Self::PipeStep { kind } => {
                write!(
                    f,
                    "`{kind}` is not an action, and only actions follow a pipe's first schema"
                )
            }
            Self::ActionMismatch { kind } => {
                write!(f, "`{kind}` is not for the type of value this pipe has")
            }
            Self::ActionOutsidePipe { kind } => write!(f, "`{kind}` outside a pipe"),
            Self::VariantOption { kind } => {
                write!(f, "a variant option must be an object schema, not `{kind}`")
            }
            Self::VariantDiscriminator { key } => {
                write!(f, "a variant option needs a `literal` entry at {key:?}")
            }
            Self::UndefinedLazy => f.write_str("a lazy that was never defined"),
            Self::RedefinedLazy => f.write_str("a lazy that is defined twice"),
            Self::UnguardedRecursion => {
                f.write_str("the schema comes back to itself without reading into the value")
            }
            Self::TooNested { limit } => write!(
                f,
                "more than {limit} wrappers, lazies, unions, and pipes around one value"
            ),
            Self::InvalidNode => f.write_str("a node id that is not this builder's"),
            Self::ArbitraryPrecision => f.write_str(
                "serde_json does not read a number as a number here, as with its \
                 `arbitrary_precision` feature on, and the crate needs it to",
            ),
            Self::TooManyNodes => f.write_str("too many nodes"),
        }
    }
}

impl fmt::Display for SchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.path.is_empty() {
            write!(f, "{}", self.kind)
        } else {
            write!(f, "{} at {}", self.kind, self.path)
        }
    }
}

impl Error for SchemaError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_utf8_names_the_line_and_column() {
        let bytes = [b"[1,\n 2, ".as_slice(), &[0xff, b']']].concat();
        let bytes = bytes.as_slice();
        let error = std::str::from_utf8(bytes).unwrap_err();
        let error = JsonError::invalid_utf8(bytes, error);
        assert_eq!(error.kind(), JsonErrorKind::InvalidUtf8);
        assert_eq!((error.line(), error.column()), (2, 5));
        assert_eq!(error.to_string(), "invalid UTF-8 at line 2 column 5");
    }

    #[test]
    fn the_kind_is_of_the_first_problem() {
        use crate::json::Json;
        // none of these is JSON to `JSON.parse`
        for (text, kind) in [
            ("1e400x", JsonErrorKind::NumberOutOfRange),
            ("[1e400,}", JsonErrorKind::NumberOutOfRange),
            (r#""\ud800\x""#, JsonErrorKind::LoneSurrogate),
            (r#"["\udc00",]"#, JsonErrorKind::LoneSurrogate),
            ("[1,}1e400", JsonErrorKind::Syntax),
            (r#"["\x\ud800"]"#, JsonErrorKind::Syntax),
        ] {
            assert_eq!(Json::parse(text).unwrap_err().kind(), kind, "{text}");
        }
    }

    #[test]
    fn schema_error_displays_its_path() {
        let error = SchemaError::new(SchemaErrorKind::EmptyPipe, "/schema/def/a");
        assert_eq!(error.to_string(), "a pipe with no schema at /schema/def/a");
        assert_eq!(error.path(), "/schema/def/a");
        let whole = SchemaError::new(SchemaErrorKind::TooManyNodes, "");
        assert_eq!(whole.to_string(), "too many nodes");
    }
}
