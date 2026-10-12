//! `fuz_schema`'s verdict on a JSON text, for JavaScript: a schema loaded
//! once from its interchange form into a handle, and whether a text matches.
//!
//! A verdict is a `bool`. Everything `fuz_schema::Schema::is_json` reports as
//! an error is `false` here: a text that is not JSON, bytes that are not
//! UTF-8, and what the crate's parser refuses.
//!
//! The input crosses into the module's memory one of three ways:
//!
//! - `CompiledSchema::is_json` takes a JavaScript string, which the glue
//!   transcodes to UTF-8 on every call.
//! - `CompiledSchema::is_json_bytes` takes a `Uint8Array`, which the glue
//!   copies in.
//! - `CompiledSchema::input_ptr` and `CompiledSchema::is_json_input` share a
//!   buffer the handle owns, which the caller fills through a view over the
//!   module's memory, so a source that can write into a view is never copied.
//!
//! A JavaScript string can hold half a surrogate pair, and UTF-8 cannot. The
//! glue writes U+FFFD in its place, so `is_json` reads a text with one as
//! though U+FFFD were there, and can accept what `JSON.parse` followed by the
//! TypeScript library would reject.

use fuz_schema::Schema;
use wasm_bindgen::prelude::*;

/// A schema ready to validate JSON texts, and the buffer `input_ptr` lends.
#[wasm_bindgen]
#[derive(Debug)]
pub struct CompiledSchema {
    schema: Schema,
    input: Vec<u8>,
}

#[wasm_bindgen]
impl CompiledSchema {
    /// Loads a schema from the text of its interchange form.
    ///
    /// # Errors
    ///
    /// When `fuz_schema::Schema::from_json` refuses `schema_json`, with its
    /// message.
    #[wasm_bindgen(constructor)]
    pub fn new(schema_json: &str) -> Result<Self, JsError> {
        match Schema::from_json(schema_json) {
            Ok(schema) => Ok(Self {
                schema,
                input: Vec::new(),
            }),
            Err(error) => Err(JsError::new(&error.to_string())),
        }
    }

    /// Whether `text` is a JSON text that matches the schema.
    pub fn is_json(&self, text: &str) -> bool {
        self.schema.is_json(text).unwrap_or(false)
    }

    /// Whether `bytes` are the UTF-8 of a JSON text that matches the schema.
    pub fn is_json_bytes(&self, bytes: &[u8]) -> bool {
        self.schema.is_json_bytes(bytes).unwrap_or(false)
    }

    /// The address in the module's memory of a buffer at least `len` bytes
    /// long, for the caller to write a text's UTF-8 into before
    /// `is_json_input`. `0` when the memory cannot hold a buffer of `len`
    /// bytes, and the buffer is left as it was.
    ///
    /// The buffer is the handle's and is kept between calls, growing when
    /// `len` is more than it has held. It is freed with the handle and never
    /// shrinks before. The address holds until the next `input_ptr`. A view
    /// over the memory holds only until the memory grows, which any call into
    /// the module can cause, so the caller makes the view after this returns.
    pub fn input_ptr(&mut self, len: usize) -> usize {
        let held = self.input.len();
        if held < len {
            if self.input.try_reserve_exact(len - held).is_err() {
                return 0;
            }
            self.input.resize(len, 0);
        }
        // never `0` for a buffer there is: an empty one's address dangles and is not null
        self.input.as_ptr().addr()
    }

    /// `is_json_bytes` of the first `len` bytes of the buffer `input_ptr`
    /// lends. `false` when the buffer is shorter than `len`.
    pub fn is_json_input(&self, len: usize) -> bool {
        self.input
            .get(..len)
            .is_some_and(|bytes| self.schema.is_json_bytes(bytes).unwrap_or(false))
    }
}
