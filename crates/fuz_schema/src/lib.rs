//! The Rust side of `fuz_schema`: the schema model of the TypeScript library
//! in `src/lib/` at the repo root, the verdict on a JSON text, and the issues
//! of one that does not match.
//!
//! A `Schema` is built with `SchemaBuilder`, or loaded from the interchange
//! form a TypeScript schema serializes to with `Schema::from_json`. It answers
//! whether a JSON text matches:
//!
//! ```
//! use fuz_schema::SchemaBuilder;
//!
//! let mut builder = SchemaBuilder::new();
//! let name = builder.string();
//! let age = builder.number();
//! let person = builder.object([("name", name), ("age", age)]);
//! let schema = builder.build(person)?;
//!
//! assert!(schema.matches_json(r#"{"name": "Ada", "age": 36}"#)?);
//! assert!(!schema.matches_json(r#"{"name": "Ada"}"#)?);
//! assert!(schema.matches_json("{").is_err());
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! The TypeScript library is the reference for what matches. It validates
//! what `JSON.parse` returns, so the semantics are JavaScript's: a string's
//! length is in UTF-16 code units, a number is a double and is tested as
//! one, and a key written twice has its last value.
//!
//! There are two evaluators:
//!
//! - `Schema::matches_json` reaches its verdict while it parses, builds no tree,
//!   and stops at the first failure.
//! - `Schema::matches_json_exact` parses the whole text into a `Json` and walks
//!   it, and agrees with the TypeScript library on every text it reads.
//!
//! `Schema::validate_json` walks the same tree for the issues: every failure
//! the TypeScript library's `parse` reports, in its order and its words.
//!
//! ```
//! use fuz_schema::{SchemaIssueKind, PathSegment, Received, Schema};
//!
//! let schema = Schema::from_json(
//!     r#"{"schema": {"kind": "array", "def": {"kind": "number"}}}"#,
//! )?;
//! let issues = schema.validate_json(r#"[1, "2"]"#)?;
//! assert_eq!(issues.len(), 1);
//! assert_eq!(issues[0].kind(), SchemaIssueKind::Number);
//! assert_eq!(issues[0].expected(), "number");
//! assert_eq!(issues[0].received(), Received::String);
//! assert_eq!(issues[0].path(), [PathSegment::Index(1)]);
//! assert!(schema.validate_json("[1, 2]")?.is_empty());
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! What the crate does not carry across is refused when a schema is built or
//! loaded, with a `SchemaBuildError` that says what and where. See
//! `SchemaBuildErrorKind`.
//!
//! The crate reads numbers as `serde_json` hands them over by default. Its
//! `arbitrary_precision` feature, which any crate of a build turns on for
//! all of them, changes that, and `SchemaBuilder::build` then makes no schema.

mod bits;
mod builder;
#[cfg(test)]
mod differential;
mod error;
mod interchange;
mod issue;
mod js;
mod json;
mod schema;
mod stream;
mod walk;

pub use builder::SchemaBuilder;
pub use error::{JsonError, JsonErrorKind, SchemaBuildError, SchemaBuildErrorKind};
pub use issue::{MAX_ISSUES, PathSegment, Received, SchemaIssue, SchemaIssueKind};
pub use json::{Json, JsonObject, MAX_DEPTH};
pub use schema::{
    MAX_NESTING, NodeId, Schema, SchemaEntries, SchemaKind, SchemaLiteral, SchemaNode, VariantDef,
    WithDefaultDef,
};

impl Schema {
    /// Loads a schema from the text of its interchange form, which is what a
    /// TypeScript schema serializes to: every node as `{"kind": …, "def": …}`
    /// in an envelope, `{"schema": node, "defs": {name: node}}`, whose `defs`
    /// are what each `lazy` names.
    ///
    /// ```
    /// use fuz_schema::Schema;
    ///
    /// let schema = Schema::from_json(
    ///     r#"{"schema": {"kind": "array", "def": {"kind": "number"}}}"#,
    /// )?;
    /// assert!(schema.matches_json("[1, 2]")?);
    /// # Ok::<(), Box<dyn std::error::Error>>(())
    /// ```
    ///
    /// # Errors
    ///
    /// When `interchange` is not JSON, writes a key twice in one object, is
    /// not shaped as the form says, or holds a schema the crate refuses, with
    /// the reason and a path to it.
    /// See `SchemaBuildErrorKind`.
    pub fn from_json(interchange: &str) -> Result<Self, SchemaBuildError> {
        interchange::load_text(interchange)
    }

    /// Whether `json` is a JSON text that matches the schema.
    ///
    /// The verdict is reached while the text is parsed and stops at the first
    /// failure, so it can be stricter than the TypeScript library's on
    /// `JSON.parse` of the same text, and is never looser:
    ///
    /// - Every occurrence of a repeated key must match, where `JSON.parse`
    ///   keeps the last.
    /// - A text that fails and is malformed after that is `Ok(false)`.
    ///
    /// A value the schema accepts whatever it is, such as one under `unknown`
    /// or at a key a `loose_object` has no entry for, is skipped without
    /// being read. An array or object that no option of a `union` could match
    /// fails without being read.
    ///
    /// # Errors
    ///
    /// When `json` is not JSON as far as it was read, and for three things
    /// `JSON.parse` reads that this crate does not: a number too large for a
    /// double, a `\u` escape of half a surrogate pair, and nesting deeper
    /// than `MAX_DEPTH`. The error is of the first problem met. See
    /// `JsonErrorKind`.
    pub fn matches_json(&self, json: &str) -> Result<bool, JsonError> {
        stream::matches_json(self, json)
    }

    /// `matches_json` for bytes, which must be UTF-8.
    ///
    /// The bytes are validated as UTF-8 first, in full, and then read as
    /// `matches_json` reads a string.
    ///
    /// # Errors
    ///
    /// When `json` is not UTF-8, and as `matches_json`.
    pub fn matches_json_bytes(&self, json: &[u8]) -> Result<bool, JsonError> {
        let text =
            std::str::from_utf8(json).map_err(|error| JsonError::invalid_utf8(json, error))?;
        self.matches_json(text)
    }

    /// Whether `json` is a JSON text that matches the schema, by parsing all
    /// of it into a `Json` and walking that.
    ///
    /// The verdict is the TypeScript library's on `JSON.parse` of the same
    /// text: a repeated key has its last value, and nothing is skipped. It
    /// costs a tree, and reads to the end of the text whatever it finds.
    ///
    /// # Errors
    ///
    /// When `json` is not JSON, and for the three things `JSON.parse` reads
    /// that this crate does not, wherever in the text they are. The error is
    /// of the first problem met. See `JsonErrorKind`.
    pub fn matches_json_exact(&self, json: &str) -> Result<bool, JsonError> {
        walk::matches_json(self, json)
    }

    /// The issues of the JSON text `json` against the schema, none when it
    /// matches, by parsing all of it into a `Json` and walking that.
    ///
    /// They are the issues the TypeScript library's `parse` reports of
    /// `JSON.parse` of the same text, in the same order: each one's kind,
    /// `expected` text, received type, and path. A message a TypeScript
    /// schema sets is not carried, because the interchange form holds none.
    /// The issues are empty exactly when `matches_json_exact` is `true`, and
    /// are the first `MAX_ISSUES` of a text that fails more often, as there.
    ///
    /// # Errors
    ///
    /// As `matches_json_exact`.
    pub fn validate_json(&self, json: &str) -> Result<Vec<SchemaIssue>, JsonError> {
        walk::validate_json(self, json)
    }

    /// `validate_json` for bytes, which must be UTF-8.
    ///
    /// The bytes are validated as UTF-8 first, in full, and then read as
    /// `validate_json` reads a string.
    ///
    /// # Errors
    ///
    /// When `json` is not UTF-8, and as `validate_json`.
    pub fn validate_json_bytes(&self, json: &[u8]) -> Result<Vec<SchemaIssue>, JsonError> {
        let text =
            std::str::from_utf8(json).map_err(|error| JsonError::invalid_utf8(json, error))?;
        self.validate_json(text)
    }
}
