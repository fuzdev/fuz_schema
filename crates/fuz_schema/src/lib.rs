//! The Rust side of `fuz_schema`: the schema model of the TypeScript library
//! in `src/lib/` at the repo root, and the verdict on a JSON text.
//!
//! A `Schema` is built with `SchemaBuilder`. It answers whether a JSON text
//! matches:
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
//! assert!(schema.is_json(r#"{"name": "Ada", "age": 36}"#)?);
//! assert!(!schema.is_json(r#"{"name": "Ada"}"#)?);
//! assert!(schema.is_json("{").is_err());
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
//! - `Schema::is_json` reaches its verdict while it parses, builds no tree,
//!   and stops at the first failure.
//! - `Schema::is_json_exact` parses the whole text into a `Json` and walks
//!   it, and agrees with the TypeScript library on every text it reads.
//!
//! What the crate does not carry across is refused when a schema is built,
//! with a `SchemaError` that says what and where. See `SchemaErrorKind`.
//!
//! The crate reads numbers as `serde_json` hands them over by default. Its
//! `arbitrary_precision` feature, which any crate of a build turns on for
//! all of them, changes that, and `SchemaBuilder::build` then makes no schema.

mod bits;
mod builder;
#[cfg(test)]
mod differential;
mod error;
mod js;
mod json;
mod schema;
mod stream;
mod walk;

pub use builder::SchemaBuilder;
pub use error::{JsonError, JsonErrorKind, SchemaError, SchemaErrorKind};
pub use json::{Json, JsonObject, MAX_DEPTH};
pub use schema::{
    DefaultDef, Entries, Kind, Literal, MAX_NESTING, Node, NodeId, Schema, VariantDef,
};

impl Schema {
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
    pub fn is_json(&self, json: &str) -> Result<bool, JsonError> {
        stream::is_json(self, json)
    }

    /// `is_json` for bytes, which must be UTF-8.
    ///
    /// The bytes are validated as UTF-8 first, in full, and then read as
    /// `is_json` reads a string.
    ///
    /// # Errors
    ///
    /// When `json` is not UTF-8, and as `is_json`.
    pub fn is_json_bytes(&self, json: &[u8]) -> Result<bool, JsonError> {
        let text =
            std::str::from_utf8(json).map_err(|error| JsonError::invalid_utf8(json, error))?;
        self.is_json(text)
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
    pub fn is_json_exact(&self, json: &str) -> Result<bool, JsonError> {
        walk::is_json(self, json)
    }
}
