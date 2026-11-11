use super::*;

/// Adds a schema to a builder.
type Make = fn(&mut SchemaBuilder) -> NodeId;
/// Adds a schema around another.
type Wrap = fn(&mut SchemaBuilder, NodeId) -> NodeId;

fn refusal(build: impl FnOnce(&mut SchemaBuilder) -> NodeId) -> (SchemaBuildErrorKind, String) {
    let mut builder = SchemaBuilder::new();
    let root = build(&mut builder);
    let error = builder.build(root).unwrap_err();
    (error.kind().clone(), error.path().to_owned())
}

fn built(build: impl FnOnce(&mut SchemaBuilder) -> NodeId) -> Schema {
    let mut builder = SchemaBuilder::new();
    let root = build(&mut builder);
    builder.build(root).unwrap()
}

#[test]
fn non_finite_numbers_are_refused() {
    for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            refusal(|b| b.literal(number)),
            (
                SchemaBuildErrorKind::NonFiniteNumber,
                "/schema/def".to_owned()
            )
        );
        assert_eq!(
            refusal(|b| b.one_of([1.0, number])),
            (
                SchemaBuildErrorKind::NonFiniteNumber,
                "/schema/def/1".to_owned()
            )
        );
        assert_eq!(
            refusal(|b| {
                let head = b.number();
                let bound = b.min_value(number);
                b.pipe([head, bound])
            }),
            (
                SchemaBuildErrorKind::NonFiniteNumber,
                "/schema/def/1/def".to_owned()
            )
        );
    }
}

#[test]
fn prototype_keys_are_refused() {
    for key in js::OBJECT_PROTOTYPE_KEYS {
        for kind in 0..3 {
            let (error, path) = refusal(|b| {
                let s = b.string();
                let entries = [("ok", s), (key, s)];
                let object = match kind {
                    0 => b.object(entries),
                    1 => b.loose_object(entries),
                    _ => b.strip_object(entries),
                };
                b.array(object)
            });
            assert_eq!(
                error,
                SchemaBuildErrorKind::PrototypeKey { key: key.into() }
            );
            assert_eq!(path, format!("/schema/def/def/{key}"));
        }
        // a `variant` with no option reads its key off the input all the same
        let (error, path) = refusal(|b| {
            let variant = b.variant(key, []);
            b.array(variant)
        });
        assert_eq!(
            error,
            SchemaBuildErrorKind::PrototypeKey { key: key.into() }
        );
        assert_eq!(path, "/schema/def/def/key");
        // with options the key is an entry, and is refused as one
        let (error, path) = refusal(|b| {
            let literal = b.literal("a");
            let option = b.object([(key, literal)]);
            b.variant(key, [option])
        });
        assert_eq!(
            error,
            SchemaBuildErrorKind::PrototypeKey { key: key.into() }
        );
        assert_eq!(path, format!("/schema/def/options/0/def/{key}"));
    }
}

#[test]
fn duplicate_keys_are_refused() {
    assert_eq!(
        refusal(|b| {
            let s = b.string();
            b.object([("a", s), ("b", s), ("a", s)])
        }),
        (
            SchemaBuildErrorKind::DuplicateKey { key: "a".into() },
            "/schema".to_owned()
        )
    );
}

#[test]
fn pipes_are_checked() {
    assert_eq!(
        refusal(|b| b.pipe([])),
        (SchemaBuildErrorKind::EmptyPipe, "/schema".to_owned())
    );
    for head in [
        SchemaKind::Unknown,
        SchemaKind::Boolean,
        SchemaKind::Nullable,
        SchemaKind::MinLength,
    ] {
        let (error, path) = refusal(|b| {
            let string = b.string();
            let head = match head {
                SchemaKind::Unknown => b.unknown(),
                SchemaKind::Boolean => b.boolean(),
                SchemaKind::Nullable => b.nullable(string),
                _ => b.min_length(1.0),
            };
            b.pipe([head])
        });
        assert_eq!(error, SchemaBuildErrorKind::PipeHead { kind: head });
        assert_eq!(path, "/schema/def/0");
    }
    assert_eq!(
        refusal(|b| {
            let string = b.string();
            let again = b.string();
            b.pipe([string, again])
        }),
        (
            SchemaBuildErrorKind::PipeStep {
                kind: SchemaKind::String
            },
            "/schema/def/1".to_owned()
        )
    );
    let mismatches: [(Make, Make, SchemaKind); 10] = [
        (
            SchemaBuilder::string,
            |b| b.min_value(0.0),
            SchemaKind::MinValue,
        ),
        (
            SchemaBuilder::string,
            SchemaBuilder::integer,
            SchemaKind::Integer,
        ),
        (
            SchemaBuilder::number,
            |b| b.max_length(1.0),
            SchemaKind::MaxLength,
        ),
        (
            SchemaBuilder::integer,
            |b| b.min_length(1.0),
            SchemaKind::MinLength,
        ),
        (
            |b| {
                let item = b.string();
                b.array(item)
            },
            SchemaBuilder::safe_integer,
            SchemaKind::SafeInteger,
        ),
        (
            |b| {
                let item = b.string();
                b.array(item)
            },
            |b| b.max_value(1.0),
            SchemaKind::MaxValue,
        ),
        (SchemaBuilder::number, SchemaBuilder::uuid, SchemaKind::Uuid),
        (
            SchemaBuilder::integer,
            SchemaBuilder::iso_datetime,
            SchemaKind::IsoDatetime,
        ),
        (
            |b| {
                let item = b.string();
                b.array(item)
            },
            SchemaBuilder::uuid,
            SchemaKind::Uuid,
        ),
        (
            SchemaBuilder::number,
            SchemaBuilder::to_lower_case,
            SchemaKind::ToLowerCase,
        ),
    ];
    for (head, action, kind) in mismatches {
        let (error, path) = refusal(|b| {
            let head = head(b);
            let ok = match b.nodes[head.index()].kind() {
                SchemaKind::String | SchemaKind::Array => b.min_length(0.0),
                _ => b.integer(),
            };
            let action = action(b);
            b.pipe([head, ok, action])
        });
        assert_eq!(error, SchemaBuildErrorKind::ActionMismatch { kind });
        assert_eq!(path, "/schema/def/2");
    }
}

#[test]
fn a_pipe_can_start_with_a_pipe_or_a_number_test() {
    built(|b| {
        let string = b.string();
        let min = b.min_length(1.0);
        let inner = b.pipe([string, min]);
        let max = b.max_length(5.0);
        b.pipe([inner, max])
    });
    built(|b| {
        let integer = b.integer();
        let min = b.min_value(0.0);
        b.pipe([integer, min])
    });
    built(|b| {
        let item = b.safe_integer();
        b.array(item)
    });
}

#[test]
fn bounds_outside_a_pipe_are_refused() {
    let actions: [(Make, SchemaKind); 4] = [
        (|b| b.min_length(1.0), SchemaKind::MinLength),
        (|b| b.max_length(1.0), SchemaKind::MaxLength),
        (|b| b.min_value(1.0), SchemaKind::MinValue),
        (|b| b.max_value(1.0), SchemaKind::MaxValue),
    ];
    for (action, kind) in actions {
        let expected = SchemaBuildErrorKind::ActionOutsidePipe { kind };
        assert_eq!(refusal(action), (expected.clone(), "/schema".to_owned()));
        let parents: [(Wrap, &str); 9] = [
            (|b, a| b.optional(a), "/schema/def/schema"),
            (|b, a| b.nullable(a), "/schema/def/schema"),
            (|b, a| b.with_default(a, Json::Null), "/schema/def/schema"),
            (|b, a| b.array(a), "/schema/def"),
            (|b, a| b.record(a), "/schema/def"),
            (|b, a| b.object([("a/b~c", a)]), "/schema/def/a~1b~0c"),
            (|b, a| b.loose_object([("x", a)]), "/schema/def/x"),
            (
                |b, a| {
                    let s = b.string();
                    b.union([s, a])
                },
                "/schema/def/1",
            ),
            (
                |b, a| {
                    let lazy = b.declare();
                    b.define(lazy, a);
                    lazy
                },
                "/defs/$0",
            ),
        ];
        for (parent, path) in parents {
            assert_eq!(
                refusal(|b| {
                    let action = action(b);
                    parent(b, action)
                }),
                (expected.clone(), path.to_owned())
            );
        }
    }
}

#[test]
fn variants_are_checked() {
    assert_eq!(
        refusal(|b| {
            let a = b.literal("a");
            let object = b.object([("k", a)]);
            let string = b.string();
            b.variant("k", [object, string])
        }),
        (
            SchemaBuildErrorKind::VariantOption {
                kind: SchemaKind::String
            },
            "/schema/def/options/1".to_owned()
        )
    );
    let options: [Make; 4] = [
        |b| b.object::<&str>([]),
        |b| {
            let s = b.string();
            b.object([("k", s)])
        },
        |b| {
            let a = b.literal("a");
            let optional = b.optional(a);
            b.object([("k", optional)])
        },
        |b| {
            let a = b.literal("a");
            b.object([("other", a)])
        },
    ];
    for build in options {
        assert_eq!(
            refusal(|b| {
                let option = build(b);
                b.variant("k", [option])
            }),
            (
                SchemaBuildErrorKind::VariantDiscriminator { key: "k".into() },
                "/schema/def/options/0".to_owned()
            )
        );
    }
    // no options never matches, and is not refused
    built(|b| b.variant("k", []));
}

#[test]
fn lazies_are_checked() {
    assert_eq!(
        refusal(|b| {
            let lazy = b.declare();
            b.array(lazy)
        }),
        (
            SchemaBuildErrorKind::UndefinedLazy,
            "/schema/def".to_owned()
        )
    );
    assert_eq!(
        refusal(|b| {
            let lazy = b.declare();
            let s = b.string();
            b.define(lazy, s);
            b.define(lazy, s);
            lazy
        }),
        (SchemaBuildErrorKind::RedefinedLazy, String::new())
    );
    assert_eq!(
        refusal(|b| {
            let s = b.string();
            b.define(s, s);
            s
        }),
        (SchemaBuildErrorKind::InvalidNode, String::new())
    );
    // a lazy never used and never defined is out of reach
    built(|b| {
        b.declare();
        b.string()
    });
}

#[test]
fn foreign_ids_are_refused() {
    let mut other = SchemaBuilder::new();
    for _ in 0..5 {
        other.string();
    }
    let foreign = other.string();
    assert_eq!(
        refusal(|_| foreign),
        (SchemaBuildErrorKind::InvalidNode, "/schema".to_owned())
    );
    assert_eq!(
        refusal(|b| b.array(foreign)),
        (SchemaBuildErrorKind::InvalidNode, "/schema/def".to_owned())
    );
    // in range, and not made before the node that uses it
    assert_eq!(
        refusal(|b| {
            let array = b.array(foreign);
            for _ in 0..8 {
                b.string();
            }
            array
        }),
        (SchemaBuildErrorKind::InvalidNode, "/schema/def".to_owned())
    );
    assert_eq!(
        refusal(|b| {
            let lazy = b.declare();
            b.define(lazy, foreign);
            lazy
        }),
        (SchemaBuildErrorKind::InvalidNode, "/defs/$0".to_owned())
    );
}

#[test]
fn unguarded_recursion_is_refused() {
    let cycles: [Wrap; 6] = [
        |_, lazy| lazy,
        |b, lazy| b.optional(lazy),
        |b, lazy| b.nullable(lazy),
        |b, lazy| b.with_default(lazy, Json::Null),
        |b, lazy| {
            let s = b.string();
            b.union([s, lazy])
        },
        |b, lazy| {
            let other = b.declare();
            b.define(other, lazy);
            b.nullable(other)
        },
    ];
    for cycle in cycles {
        let (error, _) = refusal(|b| {
            let lazy = b.declare();
            let target = cycle(b, lazy);
            b.define(lazy, target);
            b.array(lazy)
        });
        assert_eq!(error, SchemaBuildErrorKind::UnguardedRecursion);
    }
    assert_eq!(
        refusal(|b| {
            let lazy = b.declare();
            let optional = b.optional(lazy);
            b.define(lazy, optional);
            lazy
        }),
        (
            SchemaBuildErrorKind::UnguardedRecursion,
            "/schema".to_owned()
        )
    );
}

#[test]
fn recursion_through_a_container_is_guarded() {
    let guards: [Wrap; 5] = [
        |b, lazy| b.array(lazy),
        |b, lazy| b.record(lazy),
        |b, lazy| b.object([("next", lazy)]),
        |b, lazy| {
            let optional = b.optional(lazy);
            b.loose_object([("next", optional)])
        },
        |b, lazy| {
            let tag = b.literal("t");
            let option = b.strip_object([("tag", tag), ("next", lazy)]);
            b.variant("tag", [option])
        },
    ];
    for guard in guards {
        built(|b| {
            let lazy = b.declare();
            let container = guard(b, lazy);
            let null = b.literal(SchemaLiteral::Null);
            let either = b.union([null, container]);
            b.define(lazy, either);
            lazy
        });
    }
}

#[test]
fn nesting_has_a_limit() {
    let nested = |depth: usize| {
        move |b: &mut SchemaBuilder| {
            let mut id = b.string();
            for _ in 0..depth {
                id = b.optional(id);
            }
            id
        }
    };
    built(nested(MAX_NESTING));
    assert_eq!(
        refusal(nested(MAX_NESTING + 1)),
        (
            SchemaBuildErrorKind::TooNested { limit: MAX_NESTING },
            "/schema".to_owned()
        )
    );
    // a container between them starts the count again
    built(|b| {
        let inner = nested(MAX_NESTING)(b);
        let mut id = b.array(inner);
        for _ in 0..MAX_NESTING {
            id = b.nullable(id);
        }
        id
    });
    // and so does each lazy only when it is behind a container
    assert_eq!(
        refusal(|b| {
            let inner = nested(MAX_NESTING)(b);
            let lazy = b.declare();
            b.define(lazy, inner);
            b.array(lazy)
        }),
        (
            SchemaBuildErrorKind::TooNested { limit: MAX_NESTING },
            "/schema/def".to_owned()
        )
    );
}

#[test]
fn unreachable_nodes_are_not_checked() {
    built(|b| {
        b.pipe([]);
        b.literal(f64::NAN);
        b.string()
    });
}

/// `Expr`: a `lazy` to a union of objects, each with an array of the
/// `lazy` and a `literal` at a key, given as key and value, before the
/// array when `literal_first`.
fn define_expr(b: &mut SchemaBuilder, literals: &[(&str, &str)], literal_first: bool) -> NodeId {
    let lazy = b.declare();
    let objects: Vec<NodeId> = literals
        .iter()
        .map(|&(key, value)| {
            let args = b.array(lazy);
            let literal = b.literal(value);
            if literal_first {
                b.object([(key, literal), ("args", args)])
            } else {
                b.object([("args", args), (key, literal)])
            }
        })
        .collect();
    let union = b.union(objects);
    b.define(lazy, union);
    lazy
}

/// The unions whose verdicts are kept, on arrays and on objects: those
/// with two options or more that could take the value and reach a cycle,
/// and for objects, no `literal` entry that tells those options apart
/// before they reach one. The verdicts are listed in the order the
/// builder made the unions.
#[test]
fn only_a_union_with_two_options_that_reach_a_cycle_is_memoized() {
    let memoized = |schema: &Schema| -> Vec<[bool; 2]> {
        (0..schema.nodes.len())
            .filter(|&index| matches!(schema.nodes[index], SchemaNode::Union(_)))
            .map(|index| schema.memoized[index])
            .collect()
    };
    let ab = [("op", "a"), ("op", "b")];
    // two objects that each reach the cycle before the literal
    let expr = built(|b| define_expr(b, &ab, false));
    assert_eq!(memoized(&expr), [[false, true]]);
    // the literal first: one option at most gets past it
    let told = built(|b| define_expr(b, &ab, true));
    assert_eq!(memoized(&told), [[false, false]]);
    // the same value at the key, or the values at two keys, tell nothing
    let same = built(|b| define_expr(b, &[("op", "a"), ("op", "a")], true));
    assert_eq!(memoized(&same), [[false, true]]);
    let keys = built(|b| define_expr(b, &[("op", "a"), ("kind", "b")], true));
    assert_eq!(memoized(&keys), [[false, true]]);
    // an option is looked through its wrappers to the object
    let wrapped = built(|b| {
        let lazy = b.declare();
        let a = b.literal("a");
        let args = b.array(lazy);
        let first = b.object([("op", a), ("args", args)]);
        let first = b.nullable(first);
        let c = b.literal("b");
        let args = b.array(lazy);
        let second = b.object([("op", c), ("args", args)]);
        let union = b.union([first, second]);
        b.define(lazy, union);
        lazy
    });
    assert_eq!(memoized(&wrapped), [[false, false]]);
    // a record has no entry to tell it apart
    let record = built(|b| {
        let lazy = b.declare();
        let records = b.record(lazy);
        let a = b.literal("a");
        let object = b.object([("op", a), ("x", lazy)]);
        let union = b.union([records, object]);
        b.define(lazy, union);
        lazy
    });
    assert_eq!(memoized(&record), [[false, true]]);
    // two arrays that reach the cycle
    let arrays = built(|b| {
        let lazy = b.declare();
        let first = b.array(lazy);
        let second = b.array(lazy);
        let union = b.union([first, second]);
        b.define(lazy, union);
        lazy
    });
    assert_eq!(memoized(&arrays), [[true, false]]);
    // one option that reaches a cycle, and one that could take the same
    // value and reaches none
    let one_array = built(|b| {
        let lazy = b.declare();
        let first = b.array(lazy);
        let string = b.string();
        let second = b.array(string);
        let union = b.union([first, second]);
        b.define(lazy, union);
        lazy
    });
    assert_eq!(memoized(&one_array), [[false, false]]);
    let one_object = built(|b| {
        let lazy = b.declare();
        let object = b.object([("a", lazy)]);
        let unknown = b.unknown();
        let union = b.union([object, unknown]);
        b.define(lazy, union);
        lazy
    });
    assert_eq!(memoized(&one_object), [[false, false]]);
    // the other option a recursive schema of its own: it reaches a cycle
    // too
    let other_cycle = built(|b| {
        let other = define_expr(b, &[("t", "b")], false);
        let lazy = b.declare();
        let items = b.array(lazy);
        let a = b.literal("a");
        let first = b.object([("x", items), ("t", a)]);
        let union = b.union([first, other]);
        b.define(lazy, union);
        lazy
    });
    assert_eq!(memoized(&other_cycle), [[false, false], [false, true]]);
    // a union on no cycle whose options each reach one
    let off_cycle = built(|b| {
        let json = b.declare();
        let string = b.string();
        let array = b.array(json);
        let record = b.record(json);
        let value = b.union([string, array, record]);
        b.define(json, value);
        let a = b.literal("a");
        let first = b.object([("v", json), ("t", a)]);
        let c = b.literal("b");
        let second = b.object([("v", json), ("t", c)]);
        b.union([first, second])
    });
    assert_eq!(memoized(&off_cycle), [[false, false], [false, true]]);
    // a literal after an entry that reaches a cycle, another than the
    // union's, tells nothing
    let side_first = built(|b| {
        let json = b.declare();
        let string = b.string();
        let array = b.array(json);
        let value = b.union([string, array]);
        b.define(json, value);
        let lazy = b.declare();
        let objects: Vec<NodeId> = ["a", "b"]
            .into_iter()
            .map(|op| {
                let op = b.literal(op);
                let args = b.array(lazy);
                b.object([("side", json), ("op", op), ("args", args)])
            })
            .collect();
        let union = b.union(objects);
        b.define(lazy, union);
        lazy
    });
    assert_eq!(memoized(&side_first), [[false, false], [false, true]]);
    // any JSON value: one option for an array and one for an object
    let json = built(|b| {
        let lazy = b.declare();
        let string = b.string();
        let array = b.array(lazy);
        let record = b.record(lazy);
        let union = b.union([string, array, record]);
        b.define(lazy, union);
        lazy
    });
    assert_eq!(memoized(&json), [[false, false]]);
    // two objects that reach no cycle
    let flat = built(|b| {
        let string = b.string();
        let number = b.number();
        let first = b.object([("a", string)]);
        let second = b.object([("a", number)]);
        let union = b.union([first, second]);
        b.array(union)
    });
    assert_eq!(memoized(&flat), [[false, false]]);
    // a union with one option for an object hands it to the union that
    // has two, which keeps the verdict: only that one is kept
    let nested = built(|b| {
        let lazy = b.declare();
        let a = b.literal("a");
        let args = b.array(lazy);
        let first = b.object([("args", args), ("op", a)]);
        let c = b.literal("b");
        let args = b.array(lazy);
        let second = b.object([("args", args), ("op", c)]);
        let inner = b.union([first, second]);
        let string = b.string();
        let outer = b.union([string, inner]);
        b.define(lazy, outer);
        lazy
    });
    assert_eq!(memoized(&nested), [[false, true], [false, false]]);
}

#[test]
fn pointer_tokens_escape_their_two_characters() {
    assert_eq!(pointer_token("a/b~c"), "a~1b~0c");
    assert_eq!(pointer_token("~1"), "~01");
    assert_eq!(pointer_token(""), "");
}
