//! The fixtures shared with the TypeScript library, under
//! `src/test/fixtures/json/` at the repo root.
//!
//! Each group's `expected.json` holds a schema in the interchange form and
//! what the TypeScript library makes of a list of JSON texts: whether
//! `JSON.parse` reads each, whether what it read matches, and the issues of
//! what does not. Both evaluators must say the same, except where a case
//! declares how the crate diverges, and then they must do exactly what is
//! declared. Wherever the tree evaluator gives a verdict, `validate_json`
//! must give the library's issues, each one whole and in its order.
//!
//! When `FUZ_SCHEMA_FIXTURES_DIR` is set, the groups under it are loaded too:
//! `npm run fixtures:deep` writes generated groups there.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use fuz_schema::{
    Json, JsonError, JsonErrorKind, MAX_DEPTH, MAX_ISSUES, MAX_NESTING, PathSegment, Received,
    Schema, SchemaBuildErrorKind, SchemaBuilder, SchemaIssue, SchemaIssueKind, SchemaKind,
    SchemaNode,
};
use serde::de::IgnoredAny;
use serde_json::{Value, json};

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
    /// The library's issues, as generated: empty for a text that matches,
    /// and `None` with no verdict.
    issues: Option<Value>,
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

/// Loads every group, or says what about the fixtures is not as generated:
/// the committed groups, and those under `FUZ_SCHEMA_FIXTURES_DIR` when it is
/// set, which the deep lane of `src/test/fixtures/json/deep.ts` writes.
fn load_groups() -> Result<Vec<Group>, String> {
    let mut groups = load_dir(&fixtures_dir())?;
    if let Some(extra) = std::env::var_os("FUZ_SCHEMA_FIXTURES_DIR") {
        if extra.is_empty() {
            return Err("FUZ_SCHEMA_FIXTURES_DIR is set but empty".to_owned());
        }
        let extra = load_dir(Path::new(&extra))?;
        if extra.is_empty() {
            return Err("FUZ_SCHEMA_FIXTURES_DIR has no groups".to_owned());
        }
        groups.extend(extra);
    }
    Ok(groups)
}

/// Loads the groups of one directory, a group to a subdirectory.
fn load_dir(dir: &Path) -> Result<Vec<Group>, String> {
    let read = |error: std::io::Error| format!("cannot read {}: {error}", dir.display());
    let mut names = Vec::new();
    for entry in fs::read_dir(dir).map_err(read)? {
        let entry = entry.map_err(read)?;
        if entry.file_type().map_err(read)?.is_dir() {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    names.sort();
    names
        .into_iter()
        .map(|name| load_group(dir, name))
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
        let issues = match (oracle, case.get("issues")) {
            (Some(valid), Some(Value::Array(issues))) if valid == issues.is_empty() => {
                Some(Value::Array(issues.clone()))
            }
            (None, None) => None,
            (_, other) => {
                return Err(format!(
                    "{what}: oracle {oracle:?} does not go with issues {other:?}"
                ));
            }
        };
        let diverges = match case.get("diverges") {
            Some(_) => Some(string(case, "diverges", &what)?),
            None => None,
        };
        cases.push(Case {
            text: string(case, "text", &what)?,
            oracle,
            issues,
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

/// An issue as `expected.json` holds one: the library's, without `message`.
/// A key of the path is a string and an index a number, as they are there,
/// and `formatted` is what `format_issue` writes of it.
fn issue_json(issue: &SchemaIssue) -> Value {
    let path: Vec<Value> = issue
        .path()
        .iter()
        .map(|segment| match segment {
            PathSegment::Key(key) => json!(key),
            PathSegment::Index(index) => json!(index),
        })
        .collect();
    json!({
        "kind": issue.kind().as_str(),
        "expected": issue.expected(),
        "received": issue.received().as_str(),
        "path": path,
        "formatted": issue.to_string(),
    })
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
            let stream = group.schema.matches_json(&case.text);
            let exact = group.schema.matches_json_exact(&case.text);
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
                failures.push(format!("{at}: matches_json {why}"));
            }
            if let Some(why) = check(expect_exact, &exact, case.oracle) {
                failures.push(format!("{at}: matches_json_exact {why}"));
            }
            // with nothing declared the two agree, error for error
            if case.diverges.is_none() && stream.is_ok() != exact.is_ok() {
                failures.push(format!(
                    "{at}: matches_json {stream:?}, matches_json_exact {exact:?}"
                ));
            }
            // and the streaming evaluator is never the looser of the two
            if stream == Ok(true) && exact == Ok(false) {
                failures.push(format!(
                    "{at}: matches_json accepts what matches_json_exact rejects"
                ));
            }
            let bytes = group.schema.matches_json_bytes(case.text.as_bytes());
            if bytes != stream {
                failures.push(format!(
                    "{at}: matches_json_bytes {bytes:?}, matches_json {stream:?}"
                ));
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

/// `validate_json` is the tree evaluator: it errs where `matches_json_exact` errs,
/// has no issues where that is `true`, and where that gives the library's
/// verdict its issues are the library's.
#[test]
fn validate_json_reports_the_issues_of_the_oracle() {
    let mut failures = Vec::new();
    let mut compared = 0;
    for group in load_groups().unwrap() {
        for case in &group.cases {
            let at = format!("{}/{}", group.name, case.name);
            let exact = group.schema.matches_json_exact(&case.text);
            let issues = group.schema.validate_json(&case.text);
            let verdict = issues.as_ref().map(Vec::is_empty).map_err(Clone::clone);
            if verdict != exact {
                failures.push(format!(
                    "{at}: validate_json {issues:?}, matches_json_exact {exact:?}"
                ));
            }
            let bytes = group.schema.validate_json_bytes(case.text.as_bytes());
            if bytes != issues {
                failures.push(format!(
                    "{at}: validate_json_bytes {bytes:?}, validate_json {issues:?}"
                ));
            }
            // a flag whose tree column is not the oracle's is an error above
            let oracle = case
                .diverges
                .as_deref()
                .is_none_or(|flag| matches!(declared(flag), Some((_, Expect::Oracle))));
            let (true, Some(expected), Ok(issues)) = (oracle, &case.issues, &issues) else {
                continue;
            };
            compared += 1;
            let actual = Value::Array(issues.iter().map(issue_json).collect());
            if actual != *expected {
                failures.push(format!("{at}: issues {actual}, the oracle's {expected}"));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
    assert!(compared >= MIN_CASES / 2, "{compared} cases compared");
}

/// Every kind of issue, and every received type, is one some case's issues
/// have, so that none is only ever compared as absent.
#[test]
fn every_issue_kind_and_received_type_is_reported_by_a_case() {
    let groups = load_groups().unwrap();
    let issues: Vec<SchemaIssue> = groups
        .iter()
        .flat_map(|group| {
            group
                .cases
                .iter()
                .filter_map(|case| group.schema.validate_json(&case.text).ok())
        })
        .flatten()
        .collect();
    for &kind in SchemaIssueKind::ALL {
        assert!(
            issues.iter().any(|issue| issue.kind() == kind),
            "no case has a `{kind}` issue"
        );
    }
    for &received in Received::ALL {
        assert!(
            issues.iter().any(|issue| issue.received() == received),
            "no case has an issue that received `{received}`"
        );
    }
    // a path of each kind of step, a key `Display` quotes, and the root's, which has none
    let has =
        |find: fn(&PathSegment) -> bool| issues.iter().any(|issue| issue.path().iter().any(find));
    assert!(has(|segment| matches!(segment, PathSegment::Key(_))));
    assert!(has(|segment| matches!(
        segment,
        PathSegment::Key(key) if !key.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    )));
    assert!(has(|segment| matches!(segment, PathSegment::Index(_))));
    assert!(issues.iter().any(|issue| issue.path().is_empty()));
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
    let kinds: Vec<SchemaKind> = groups
        .iter()
        .flat_map(|group| group.schema.nodes().map(SchemaNode::kind))
        .collect();
    for kind in SchemaKind::ALL {
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
    assert_eq!(number("max_issues"), u64::try_from(MAX_ISSUES).ok());
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
            matches!(error.kind(), SchemaBuildErrorKind::UnsupportedKind { kind: refused } if **refused == *kind),
            "{kind}: {error}"
        );
        assert_eq!(SchemaKind::from_name(&kind), None, "{kind}");
    }
    let keys = strings(contract, "object_prototype_keys", "contract.json").unwrap();
    assert!(!keys.is_empty());
    for key in keys {
        let mut builder = SchemaBuilder::new();
        let string = builder.string();
        let entries = builder.object([(key.as_str(), string)]);
        let error = builder.build(entries).unwrap_err();
        assert!(
            matches!(error.kind(), SchemaBuildErrorKind::PrototypeKey { key: refused } if **refused == *key),
            "{key}: {error}"
        );
    }
}
