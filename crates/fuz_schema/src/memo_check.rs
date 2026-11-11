//! The unions that keep their verdicts, held to what they give without: every
//! fixture group, and those of `FUZ_SCHEMA_FIXTURES_DIR` when it is set, with
//! each union's memo on and then off, over every text.
//!
//! A verdict of `walk::run` is a function of the node and the value, so a kept
//! one changes no verdict and no issue. A walker that comes to read anything
//! else makes a kept verdict wrong where it differs, and this is where that
//! shows.
//!
//! Without the memo some texts take time exponential in their depth. A text
//! whose unions run more options without it than `BUDGET_FACTOR` times what
//! they run with it, and `BUDGET_FLOOR` more, is skipped, and printed: the
//! test fails when every text the memo changes the work of is skipped.

use std::fs;
use std::path::{Path, PathBuf};

use serde::de::IgnoredAny;
use serde_json::Value;

use crate::error::JsonError;
use crate::issue::SchemaIssue;
use crate::schema::Schema;
use crate::stream;
use crate::walk::{self, tests::within_budget};

/// How many times the option runs with the memo those without may be.
const BUDGET_FACTOR: usize = 64;
/// And how many more.
const BUDGET_FLOOR: usize = 1 << 16;

/// What the three evaluators make of a text.
#[derive(Debug, PartialEq)]
struct Answers {
    exact: Result<bool, JsonError>,
    stream: Result<bool, JsonError>,
    issues: Result<Vec<SchemaIssue>, JsonError>,
}

fn answers(schema: &Schema, text: &str) -> Answers {
    Answers {
        exact: walk::matches_json(schema, text),
        stream: stream::matches_json(schema, text),
        issues: walk::validate_json(schema, text),
    }
}

/// The text of the value at `schema`, which the generator writes first, so
/// that its entries load in the order they were written.
fn schema_text<'a>(text: &'a str, name: &str) -> &'a str {
    let rest = text
        .trim_start()
        .strip_prefix('{')
        .map(str::trim_start)
        .and_then(|rest| rest.strip_prefix("\"schema\""))
        .map(str::trim_start)
        .and_then(|rest| rest.strip_prefix(':'))
        .unwrap_or_else(|| panic!("{name} does not start with its `schema`"));
    let mut values = serde_json::Deserializer::from_str(rest).into_iter::<IgnoredAny>();
    assert!(
        matches!(values.next(), Some(Ok(_))),
        "{name}: its `schema` is not JSON"
    );
    &rest[..values.byte_offset()]
}

/// A fixture group: its name, its schema, and its texts by name.
struct Group {
    name: String,
    schema: Schema,
    cases: Vec<(String, String)>,
}

/// Each group of `dir`.
fn groups(dir: &Path) -> Vec<Group> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", dir.display()))
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
        .into_iter()
        .map(|name| {
            let path = dir.join(&name).join("expected.json");
            let text = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
            let schema = Schema::from_json(schema_text(&text, &name))
                .unwrap_or_else(|error| panic!("{name}: {error}"));
            let expected: Value = serde_json::from_str(&text).unwrap();
            let cases = expected["cases"]
                .as_array()
                .unwrap_or_else(|| panic!("{name} has no cases"))
                .iter()
                .map(|case| {
                    let field = |key: &str| case[key].as_str().unwrap().to_owned();
                    (field("name"), field("text"))
                })
                .collect();
            Group {
                name,
                schema,
                cases,
            }
        })
        .collect()
}

#[test]
fn a_kept_verdict_changes_no_verdict_and_no_issue() {
    let mut dirs =
        vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src/test/fixtures/json")];
    if let Some(extra) = std::env::var_os("FUZ_SCHEMA_FIXTURES_DIR") {
        dirs.push(PathBuf::from(extra));
    }
    let mut failures = Vec::new();
    let mut skipped = Vec::new();
    // the texts the memo saved work on, and those compared of them
    let mut saved = 0;
    let mut compared = 0;
    for dir in &dirs {
        for Group {
            name: group,
            schema,
            cases,
        } in groups(dir)
        {
            let without = schema.without_memo();
            if without == schema {
                // no union keeps anything, so the two are one schema
                continue;
            }
            for (name, text) in &cases {
                let at = format!("{group}/{name}");
                let (with, runs) = within_budget(usize::MAX, || answers(&schema, text))
                    .unwrap_or_else(|| unreachable!("an unbounded budget"));
                let budget = runs
                    .saturating_mul(BUDGET_FACTOR)
                    .saturating_add(BUDGET_FLOOR);
                let Some((off, runs_off)) = within_budget(budget, || answers(&without, text))
                else {
                    skipped.push(format!("{at}: more than {budget} option runs, {runs} with"));
                    continue;
                };
                compared += 1;
                if runs_off > runs {
                    saved += 1;
                }
                if with != off {
                    failures.push(format!("{at}: with the memo {with:?}, without {off:?}"));
                }
            }
        }
    }
    for skip in &skipped {
        println!("skipped {skip}");
    }
    println!(
        "{compared} texts compared, the memo saving work on {saved}, {} skipped",
        skipped.len()
    );
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
    // a run in which the memo did nothing, or which skipped every text it
    // did something to, held nothing to anything
    assert!(saved > 0, "no text compared that the memo saves work on");
}
