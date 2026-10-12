//! The fixtures shared with the TypeScript library, under
//! `src/test/fixtures/json/` at the repo root.
//!
//! Each group's `expected.json` holds a schema in the interchange form and
//! what the TypeScript library makes of a list of JSON texts: whether
//! `JSON.parse` reads each, and whether what it read matches. Both evaluators
//! must say the same, except where a case declares how the crate diverges,
//! and then they must do exactly what is declared.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use fuz_schema::{
    Json, JsonError, JsonErrorKind, Kind, MAX_DEPTH, MAX_NESTING, Node, Schema, SchemaBuilder,
    SchemaErrorKind,
};
use serde::de::IgnoredAny;
use serde_json::Value;

/// What an evaluator does with a text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Expect {
    /// What the TypeScript library does: its verdict, or an error for a text
    /// `JSON.parse` throws on.
    Oracle,
    /// `Ok(false)`, whatever the library does.
    Invalid,
    /// An error of this kind, for a text `JSON.parse` reads.
    Refused(JsonErrorKind),
}

/// Every declared divergence, with what the streaming evaluator and then the
/// tree evaluator do. A flag that is not here fails the tests.
const DIVERGENCES: [(&str, Expect, Expect); 8] = [
    ("duplicate_keys", Expect::Invalid, Expect::Oracle),
    ("malformed_tail", Expect::Invalid, Expect::Oracle),
    (
        "number_overflow",
        Expect::Refused(JsonErrorKind::NumberOutOfRange),
        Expect::Refused(JsonErrorKind::NumberOutOfRange),
    ),
    (
        "lone_surrogate",
        Expect::Refused(JsonErrorKind::LoneSurrogate),
        Expect::Refused(JsonErrorKind::LoneSurrogate),
    ),
    (
        "depth_limit",
        Expect::Refused(JsonErrorKind::DepthLimit),
        Expect::Refused(JsonErrorKind::DepthLimit),
    ),
    (
        "number_overflow_unread",
        Expect::Oracle,
        Expect::Refused(JsonErrorKind::NumberOutOfRange),
    ),
    (
        "lone_surrogate_unread",
        Expect::Oracle,
        Expect::Refused(JsonErrorKind::LoneSurrogate),
    ),
    (
        "depth_limit_unread",
        Expect::Oracle,
        Expect::Refused(JsonErrorKind::DepthLimit),
    ),
];

/// The fewest groups and cases there can be, so that a directory emptied by
/// mistake fails instead of passing with nothing to check.
const MIN_GROUPS: usize = 20;
const MIN_CASES: usize = 1000;

struct Group {
    name: String,
    schema: Schema,
    cases: Vec<Case>,
}

struct Case {
    name: String,
    text: String,
    /// The library's verdict, or `None` for a text `JSON.parse` throws on.
    oracle: Option<bool>,
    diverges: Option<String>,
}

fn string(value: &Value, key: &str, what: &str) -> Result<String, String> {
    match value.get(key) {
        Some(Value::String(value)) => Ok(value.clone()),
        other => Err(format!("{what} has no string `{key}`: {other:?}")),
    }
}

fn boolean(value: &Value, key: &str, what: &str) -> Result<bool, String> {
    match value.get(key) {
        Some(Value::Bool(value)) => Ok(*value),
        other => Err(format!("{what} has no boolean `{key}`: {other:?}")),
    }
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src/test/fixtures/json")
}

/// Reads a generated file with `serde_json`'s own tree and not the crate's,
/// so that what the crate is tested against is not read by the crate.
fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("cannot read {}: {error}", path.display()))
}

fn read_json(path: &Path) -> Result<Value, String> {
    let text = read_text(path)?;
    serde_json::from_str(&text).map_err(|error| format!("{} is not JSON: {error}", path.display()))
}

/// The text of the value at `schema`, which the generator writes first: the
/// interchange form as `to_schema_json` made it, with entries in its order.
fn schema_text<'a>(text: &'a str, name: &str) -> Result<&'a str, String> {
    let rest = text
        .trim_start()
        .strip_prefix('{')
        .map(str::trim_start)
        .and_then(|rest| rest.strip_prefix("\"schema\""))
        .map(str::trim_start)
        .and_then(|rest| rest.strip_prefix(':'))
        .ok_or_else(|| format!("{name} does not start with its `schema`"))?;
    let mut values = serde_json::Deserializer::from_str(rest).into_iter::<IgnoredAny>();
    match values.next() {
        Some(Ok(_)) => Ok(&rest[..values.byte_offset()]),
        _ => Err(format!("{name}: its `schema` is not JSON")),
    }
}

/// The strings of the array at `key`.
fn strings(value: &Value, key: &str, what: &str) -> Result<Vec<String>, String> {
    let Some(Value::Array(items)) = value.get(key) else {
        return Err(format!("{what} has no array `{key}`"));
    };
    items
        .iter()
        .map(|item| match item {
            Value::String(value) => Ok(value.clone()),
            other => Err(format!("{what}: `{key}` holds {other:?}")),
        })
        .collect()
}

/// Loads every group, or says what about the fixtures is not as generated.
fn load_groups() -> Result<Vec<Group>, String> {
    let dir = fixtures_dir();
    let read = |error: std::io::Error| format!("cannot read {}: {error}", dir.display());
    let mut names = Vec::new();
    for entry in fs::read_dir(&dir).map_err(read)? {
        let entry = entry.map_err(read)?;
        if entry.file_type().map_err(read)?.is_dir() {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    names.sort();
    names
        .into_iter()
        .map(|name| load_group(&dir, name))
        .collect()
}

fn load_group(dir: &Path, name: String) -> Result<Group, String> {
    let path = dir.join(&name).join("expected.json");
    let text = read_text(&path)?;
    let expected: Value = serde_json::from_str(&text)
        .map_err(|error| format!("{} is not JSON: {error}", path.display()))?;
    // the text as generated and not written out again, which would sort the
    // keys of each object and so lose the order entries are in
    let interchange = schema_text(&text, &name)?;
    if serde_json::from_str::<Value>(interchange).ok().as_ref() != expected.get("schema") {
        return Err(format!(
            "{name}: the text of its `schema` is not its `schema`"
        ));
    }
    let schema = Schema::from_json(interchange)
        .map_err(|error| format!("{name}: the schema does not load: {error}"))?;
    let Some(Value::Array(list)) = expected.get("cases") else {
        return Err(format!("{name} has no `cases`"));
    };
    let mut cases = Vec::with_capacity(list.len());
    for case in list {
        let case_name = string(case, "name", &name)?;
        let what = format!("{name}/{case_name}");
        let oracle = if boolean(case, "json", &what)? {
            Some(boolean(case, "valid", &what)?)
        } else {
            None
        };
        let diverges = match case.get("diverges") {
            Some(_) => Some(string(case, "diverges", &what)?),
            None => None,
        };
        cases.push(Case {
            text: string(case, "text", &what)?,
            oracle,
            diverges,
            name: case_name,
        });
    }
    Ok(Group {
        name,
        schema,
        cases,
    })
}

/// Why `actual` is not what `expect` says, when it is not.
fn check(expect: Expect, actual: &Result<bool, JsonError>, oracle: Option<bool>) -> Option<String> {
    let met = match (expect, oracle) {
        (Expect::Oracle, Some(valid)) => *actual == Ok(valid),
        // not JSON to `JSON.parse`, so not JSON here, and for no reason of the
        // crate's own
        (Expect::Oracle, None) => matches!(
            actual.as_ref().map_err(JsonError::kind),
            Err(JsonErrorKind::Syntax | JsonErrorKind::Eof)
        ),
        (Expect::Invalid, _) => *actual == Ok(false),
        (Expect::Refused(kind), _) => actual.as_ref().map_err(JsonError::kind) == Err(kind),
    };
    (!met).then(|| format!("expected {expect:?} of oracle {oracle:?}, got {actual:?}"))
}

fn declared(flag: &str) -> Option<(Expect, Expect)> {
    DIVERGENCES
        .iter()
        .find(|(name, ..)| *name == flag)
        .map(|&(_, stream, exact)| (stream, exact))
}

#[test]
fn there_are_enough_fixtures() {
    let groups = load_groups().unwrap();
    assert!(groups.len() >= MIN_GROUPS, "{} groups", groups.len());
    for group in &groups {
        assert!(!group.cases.is_empty(), "{} has no cases", group.name);
    }
    let cases: usize = groups.iter().map(|group| group.cases.len()).sum();
    assert!(cases >= MIN_CASES, "{cases} cases");
    // and enough of each answer that none of them is the only one tested
    let count = |oracle: Option<bool>| {
        groups
            .iter()
            .flat_map(|group| &group.cases)
            .filter(|case| case.oracle == oracle)
            .count()
    };
    for oracle in [Some(true), Some(false), None] {
        assert!(count(oracle) >= 100, "{oracle:?}: {}", count(oracle));
    }
}

#[test]
fn both_evaluators_match_the_oracle_or_the_declared_divergence() {
    let mut failures = Vec::new();
    for group in load_groups().unwrap() {
        for case in &group.cases {
            let at = format!("{}/{}", group.name, case.name);
            let stream = group.schema.is_json(&case.text);
            let exact = group.schema.is_json_exact(&case.text);
            let (expect_stream, expect_exact) = match &case.diverges {
                None => (Expect::Oracle, Expect::Oracle),
                Some(flag) => {
                    let Some(expects) = declared(flag) else {
                        failures.push(format!("{at}: unknown divergence {flag:?}"));
                        continue;
                    };
                    // a divergence is declared of a text it can be true of
                    let possible = match flag.as_str() {
                        "duplicate_keys" => case.oracle == Some(true),
                        "malformed_tail" => case.oracle.is_none(),
                        _ => case.oracle.is_some(),
                    };
                    if !possible {
                        failures.push(format!(
                            "{at}: {flag} cannot be declared of oracle {:?}",
                            case.oracle
                        ));
                    }
                    expects
                }
            };
            if let Some(why) = check(expect_stream, &stream, case.oracle) {
                failures.push(format!("{at}: is_json {why}"));
            }
            if let Some(why) = check(expect_exact, &exact, case.oracle) {
                failures.push(format!("{at}: is_json_exact {why}"));
            }
            // with nothing declared the two agree, error for error
            if case.diverges.is_none() && stream.is_ok() != exact.is_ok() {
                failures.push(format!("{at}: is_json {stream:?}, is_json_exact {exact:?}"));
            }
            // and the streaming evaluator is never the looser of the two
            if stream == Ok(true) && exact == Ok(false) {
                failures.push(format!("{at}: is_json accepts what is_json_exact rejects"));
            }
            let bytes = group.schema.is_json_bytes(case.text.as_bytes());
            if bytes != stream {
                failures.push(format!("{at}: is_json_bytes {bytes:?}, is_json {stream:?}"));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn every_divergence_is_known_and_declared_by_a_case() {
    let groups = load_groups().unwrap();
    let flags: BTreeSet<&str> = groups
        .iter()
        .flat_map(|group| &group.cases)
        .filter_map(|case| case.diverges.as_deref())
        .collect();
    for flag in &flags {
        assert!(declared(flag).is_some(), "unknown divergence {flag:?}");
    }
    for (flag, ..) in DIVERGENCES {
        assert!(flags.contains(flag), "no case diverges as {flag:?}");
    }
}

#[test]
fn every_kind_appears_in_a_fixture_schema() {
    let groups = load_groups().unwrap();
    let kinds: Vec<Kind> = groups
        .iter()
        .flat_map(|group| group.schema.nodes().map(Node::kind))
        .collect();
    for kind in Kind::ALL {
        assert!(kinds.contains(kind), "no fixture schema has a `{kind}`");
    }
}

/// `contract.json` holds the constants the TypeScript side has, which are the
/// crate's too.
#[test]
fn the_constants_of_both_sides_are_the_same() {
    let contract = &read_json(&fixtures_dir().join("contract.json")).unwrap();
    let number = |key: &str| contract.get(key).and_then(Value::as_u64);
    assert_eq!(number("max_nesting"), u64::try_from(MAX_NESTING).ok());
    assert_eq!(number("max_depth"), u64::try_from(MAX_DEPTH).ok());
    // and the parser reads that deep and no deeper
    for (open, leaf, close) in [("[", "", "]"), (r#"{"a":"#, "1", "}")] {
        let nested = |depth: usize| format!("{}{leaf}{}", open.repeat(depth), close.repeat(depth));
        assert!(Json::parse(&nested(MAX_DEPTH)).is_ok(), "{open}");
        assert_eq!(
            Json::parse(&nested(MAX_DEPTH + 1)).unwrap_err().kind(),
            JsonErrorKind::DepthLimit,
            "{open}"
        );
    }
    let divergences = strings(contract, "divergences", "contract.json").unwrap();
    assert_eq!(
        divergences,
        DIVERGENCES.map(|(flag, ..)| flag),
        "the divergences the fixtures declare and the ones asserted here"
    );
    let kinds = strings(contract, "unsupported_kinds", "contract.json").unwrap();
    assert!(!kinds.is_empty());
    for kind in kinds {
        let error = Schema::from_json(&format!(r#"{{"schema":{{"kind":"{kind}"}}}}"#)).unwrap_err();
        assert!(
            matches!(error.kind(), SchemaErrorKind::UnsupportedKind { kind: refused } if **refused == *kind),
            "{kind}: {error}"
        );
        assert_eq!(Kind::from_name(&kind), None, "{kind}");
    }
    let keys = strings(contract, "object_prototype_keys", "contract.json").unwrap();
    assert!(!keys.is_empty());
    for key in keys {
        let mut builder = SchemaBuilder::new();
        let string = builder.string();
        let entries = builder.object([(key.as_str(), string)]);
        let error = builder.build(entries).unwrap_err();
        assert!(
            matches!(error.kind(), SchemaErrorKind::PrototypeKey { key: refused } if **refused == *key),
            "{key}: {error}"
        );
    }
}
