/**
 * The tables the conformance rule is judged by: the differences from zod and
 * valibot that are declared, which of the two this library goes with where
 * they disagree, and what arktype and typebox do, pinned.
 * `schema.conformance.test.ts` holds the matrix's rows to them, and the
 * differential (`differential_classify.ts`) classifies what it generates by
 * them.
 *
 * A row is a case's name, with ` / strip`, ` / strict` or ` / loose` after it
 * when the case is run through the object flavors. A key of a table that ends
 * in ` / *` stands for the three, which then gave the same results. A result
 * is the text `render_parsed` writes.
 *
 * @module
 */

import { CONFORMANCE_FLAVORS, type InformationalLibName } from './conformance_test_helpers.ts';

export interface ConformanceDifference {
	/** What this library does, in a line. */
	reason: string;
	/**
	 * `declared` is deliberate, and in `docs/design.md`. `undecided` is a
	 * difference the test found that nobody has ruled on: it passes, and is
	 * printed on every run until it is conformed to or declared. The table is
	 * kept free of them.
	 */
	status: 'declared' | 'undecided';
	/** Words of `docs/design.md` that declare it, whatever the line breaks. */
	docs?: string;
	/** The rows it covers, each with what zod and valibot both did and what this library did. */
	rows: Record<string, { both: string; ours: string }>;
}

// the table, its row names kept as the type `ConformanceDifferencesRow`
const differences = [
	{
		reason:
			'a `check` that is the entry itself, or that another schema holds as one, takes a missing key as `undefined`',
		status: 'declared',
		docs: 'a `check` that is the entry itself, or that another schema holds in one of those places',
		rows: {
			'bare check entry, key missing / *': { both: 'fail at a', ours: 'ok {}' },
			'nullable(check) entry, key missing / *': { both: 'fail at a', ours: 'ok {}' },
			'lazy(check) entry, key missing / *': { both: 'fail at a', ours: 'ok {}' },
			'union[string, check] entry, key missing / *': { both: 'fail at a', ours: 'ok {}' },
			'union[unknown then a transform to null, check] entry, key missing / *': {
				both: 'fail at a',
				ours: 'ok {}'
			},
			'union[unknown then a transform to null, check] entry, key missing, null prototype / *': {
				both: 'fail at a',
				ours: 'ok {} proto=null'
			},
			'union[unknown then a transform to null, check] entry, key missing, class instance / *': {
				both: 'fail at a',
				ours: 'ok {} proto=other'
			},
			// and beside a disagreement of the two, which their refusals of the key hide
			'loose, a bare check entry, key missing, an unknown key named constructor': {
				both: 'fail at a',
				ours: 'ok {constructor: "x"}'
			},
			'loose, a bare check entry, key missing, an unknown key named prototype': {
				both: 'fail at a',
				ours: 'ok {prototype: "x"}'
			},
			'loose, a bare check entry, key missing, an unknown inherited key': {
				both: 'fail at a',
				ours: 'ok {} proto=other'
			},
			'rest, a bare check entry, key missing, an own key named constructor': {
				both: 'fail at a',
				ours: 'ok {constructor: "x"}'
			},
			'rest, a bare check entry, key missing, an own key named prototype': {
				both: 'fail at a',
				ours: 'ok {prototype: "x"}'
			},
			'rest, a bare check entry, key missing, an inherited key': {
				both: 'fail at a',
				ours: 'ok {} proto=other'
			},
			'a bare check entry and an optional(default) entry, keys missing': {
				both: 'fail at a',
				ours: 'ok {}'
			},
			'a bare check entry and a default of undefined entry, keys missing': {
				both: 'fail at a',
				ours: 'ok {}'
			},
			'a bare check entry and a default of a transform to undefined entry, keys missing': {
				both: 'fail at a',
				ours: 'ok {b: "D"}'
			},
			'a bare check entry, key missing, and a default of a transform to undefined entry, a value given':
				{ both: 'fail at a', ours: 'ok {b: undefined}' },
			'a bare check entry and an optional(string) then a transform to "T" entry, keys missing': {
				both: 'fail at a',
				ours: 'ok {}'
			},
			'union[string, object of a default of a wrong value, a bare check, and a default of undefined], keys missing':
				{ both: 'fail at <root>', ours: 'ok {a: 1}' },
			'a bare check entry and a default of undefined then a transform to "T" entry, keys missing': {
				both: 'fail at a',
				ours: 'ok {b: "T"}'
			},
			'loose, a bare check entry, key missing, an unknown key named constructor beside another, an entry that changes':
				{ both: 'fail at a', ours: 'ok {b: "T", constructor: "c", z: 1}' },
			'loose, a bare check entry, key missing, a default of a transform, an unknown key named constructor':
				{ both: 'fail at a', ours: 'ok {d: "x", constructor: 1}' },
			'loose, a bare check entry, key missing, a default of undefined, an unknown key named constructor':
				{ both: 'fail at a', ours: 'ok {constructor: 1}' },
			'a check after a strict object of a bare check entry, key missing, an unknown key': {
				both: 'fail at a +unknown keys in <root>',
				ours: 'fail +unknown keys in <root>'
			},
			'loose, a bare check entry, key missing, an unknown inherited key, an entry that changes': {
				both: 'fail at a',
				ours: 'ok {b: "T"}'
			},
			'a bare check entry, key missing, a record with an own key named constructor': {
				both: 'fail at a',
				ours: 'ok {r: {constructor: 1}}'
			},
			'loose, union[unknown then a transform to "T", check] entry, key missing, an unknown key named constructor':
				{ both: 'fail at a', ours: 'ok {constructor: "x"}' },
			'union[string, object of a bare check and a bare transform], keys missing': {
				both: 'fail at <root>',
				ours: 'ok {}'
			},
			// and in an object that is an option of a union
			'union[object of unknown then a transform to null, object of a bare check], key missing': {
				both: 'fail at <root>',
				ours: 'ok {}'
			},
			'union[strict object of a bare check, object of a check of defined], keys missing': {
				both: 'fail at <root>',
				ours: 'ok {}'
			},
			// and beside a transform under a union, a nullable, or a lazy, whose
			// missing key zod runs it on, as here, and valibot refuses
			'union[string, object of a bare check and a union[string, bare transform to "T"]], keys missing':
				{ both: 'fail at <root>', ours: 'ok {b: "T"}' },
			'union[string, object of a bare check and a nullable(bare transform to "T")], keys missing': {
				both: 'fail at <root>',
				ours: 'ok {b: "T"}'
			},
			'union[string, object of a bare check and a lazy(bare transform to "T")], keys missing': {
				both: 'fail at <root>',
				ours: 'ok {b: "T"}'
			},
			// and beside an unknown then a check that fails, after which zod runs a
			// check, and valibot, as here, refuses the missing key and stops
			'a check after an object of a bare check and unknown then a check that fails, keys missing': {
				both: 'fail at a, b',
				ours: 'fail at b'
			},
			// and beside a pipe that starts with a transform, then a check that
			// fails, which zod runs on the missing key, and valibot refuses
			'a check after an object of a bare check and a transform then a check that fails, keys missing':
				{ both: 'fail at a, b', ours: 'fail at b' },
			'a check after an array of an object of a bare check and a transform then a check that fails, keys missing':
				{ both: 'fail at [0].a, [0].b', ours: 'fail at [0].b' }
		}
	},
	{
		reason:
			'a `pipe` that starts with a `with_default` or a `with_default_fn` leaves a missing key out when its steps give `undefined`, where both write the key as `undefined`, and so do arktype and typebox. Cost declined: each form that writes it costs every object bundle bytes in its loop, or slows the object parses of a program that builds such a pipe',
		status: 'declared',
		docs: 'a `pipe` that starts with a `with_default` or a `with_default_fn` and whose steps give `undefined` leaves a missing key out',
		rows: {
			'default then a transform to undefined entry, key missing / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {}'
			},
			'message(default then a transform to undefined) entry, key missing / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {}'
			},
			'default then a transform to undefined, then a transform entry, key missing / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {}'
			},
			'default_fn then a transform to undefined entry, key missing / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {}'
			},
			'message(default_fn of undefined) then a transform entry, key missing / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {}'
			}
		}
	},
	{
		reason:
			'a `with_default_fn` whose `make` returns `undefined` leaves a missing key out, as a `with_default` of `undefined` does, where both write the key as `undefined`. Cost declined: the object loops leave out a missing key whose entry gives `undefined`, as for the `pipe` above',
		status: 'declared',
		docs: 'a `with_default_fn` whose `make` returns `undefined` leaves a missing key out',
		rows: {
			'default_fn of undefined entry, key missing / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {}'
			}
		}
	},
	{
		reason:
			'a `with_default` fills in the value it was given, the same on every parse, where zod fills in a copy of it and valibot what its schema makes of it. By design: filling it in allocates nothing, and `with_default_fn(s, () => [])` makes a new one each time',
		status: 'declared',
		docs: 'a `with_default` fills in the value it was given, the same on every parse',
		rows: {
			'default of an array, the one given': { both: 'ok false', ours: 'ok true' },
			'default of an array entry, the one given': { both: 'ok false', ours: 'ok true' }
		}
	},
	{
		reason:
			'a key read through the prototype stays inherited in an input that comes back, where a copy has it as an own key',
		status: 'declared',
		docs: 'A key read through the prototype stays inherited in an input that comes back',
		rows: {
			'required inherited / *': { both: 'ok {a: "x"}', ours: 'ok {} proto=other' },
			'optional inherited undefined / *': {
				both: 'ok {a: "x", b: undefined}',
				ours: 'ok {a: "x"} proto=other'
			},
			'unknown entry, key inherited / *': { both: 'ok {a: undefined}', ours: 'ok {} proto=other' },
			'literal(undefined) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'one_of with undefined entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'nullable(literal(undefined)) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'lazy(literal(undefined)) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'message(literal(undefined)) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'literal(undefined) then a check entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'optional(string) then a check entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'union[number, undefined] entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'nullable(one_of with undefined) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'lazy(one_of with undefined) entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'union[number, one_of with undefined] entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'one_of with undefined then a check entry, key inherited / *': {
				both: 'ok {a: undefined}',
				ours: 'ok {} proto=other'
			},
			'variant, a literal(undefined) discriminator, key inherited': {
				both: 'ok {t: undefined, x: "x"}',
				ours: 'ok {x: "x"} proto=other'
			},
			'optional inherited undefined + unknown key / loose': {
				both: 'ok {a: "x", b: undefined, z: 1}',
				ours: 'ok {a: "x", z: 1} proto=other'
			},
			'entry named constructor, unknown, missing / *': {
				both: 'ok {constructor: fn}',
				ours: 'ok {}'
			}
		}
	},
	{
		reason:
			'a `loose_object` input that comes back keeps an own `__proto__` key, which a copy leaves out',
		status: 'declared',
		docs: 'The input returned as it is keeps them all',
		rows: {
			'unknown own __proto__ key / loose': {
				both: 'ok {a: "x"}',
				ours: 'ok {a: "x", __proto__: {q: 1}}'
			}
		}
	},
	{
		reason:
			'a `loose_object` or `object_with_rest` input that comes back still inherits an enumerable `__proto__` key, which both copies drop',
		status: 'declared',
		docs: 'an input that comes back still inherits an enumerable `__proto__` key, which both copies drop',
		rows: {
			'unknown inherited __proto__ key / loose': {
				both: 'ok {a: "x"}',
				ours: 'ok {a: "x"} proto=other'
			},
			'rest, inherited __proto__ key': { both: 'ok {a: "x"}', ours: 'ok {a: "x"} proto=other' }
		}
	},
	{
		reason:
			'a `max_length` after an array too long that holds an item zod refuses and valibot takes reports the item, where both report the length: zod checks the length first, and valibot takes the item. It follows from going with zod on the item, an infinity, an array where an object or a record is, or an own key named `constructor` or `prototype` whose value is wrong, and with valibot on a length check after an array whose item fails, which the value of an own key named `prototype` of a `record` item can be',
		status: 'declared',
		docs: 'a `max_length` after an array too long that holds an item Zod refuses and Valibot takes reports the item',
		rows: {
			'a max_length after an array too long, an Infinity item': {
				both: 'fail at <root>',
				ours: 'fail at [0]'
			},
			'a max_length after an array too long, an array item of an object': {
				both: 'fail at <root>',
				ours: 'fail at [0]'
			},
			'a max_length after an array too long, an array item of a record': {
				both: 'fail at <root>',
				ours: 'fail at [0]'
			},
			'a max_length after an array too long, an array item of an object with a rest': {
				both: 'fail at <root>',
				ours: 'fail at [0]'
			},
			'a max_length after an array too long, an item with an own key named constructor, wrong': {
				both: 'fail at <root>',
				ours: 'fail at [0].constructor'
			},
			'a max_length after an array too long, an item with an own key named prototype, wrong': {
				both: 'fail at <root>',
				ours: 'fail at [0].prototype'
			},
			'a max_length after an array too long, an item with an own key named prototype, a max_length after an array too long, an item wrong':
				{ both: 'fail at <root>', ours: 'fail at [0].prototype.[0]' }
		}
	},
	{
		reason:
			'a `union` that both take, by different options, each of which this library refuses with the one of the two that refuses it, fails, where both fail only for another key: an array whose string is too long counted in UTF-16 code units, which zod takes, and the array as a `record`, which valibot takes. It follows from going with valibot on the length of a string and with zod on an array given to a record',
		status: 'declared',
		docs: 'a `union` that both take, by different options, fails where this library refuses each option',
		rows: {
			'union[array(max_length(string, 1)), record(string)] entry, an array of a surrogate pair, beside a key missing':
				{ both: 'fail at a', ours: 'fail at a, b' }
		}
	},
	{
		reason:
			'an own key named `constructor` or `prototype` of an `object_with_rest` or `record` input fails where valibot refuses its value and zod takes it, where both pass it, as valibot leaves the key out unread: a `max_length` its string passes counting a surrogate pair as one, or a default whose schema gives `undefined` for a value given, then a check. It follows from going with zod on those keys, and with valibot on the value',
		status: 'declared',
		docs: 'fails where Valibot refuses its value and Zod takes it',
		rows: {
			'rest, own key named constructor, a surrogate pair too long': {
				both: 'fail at a',
				ours: 'fail at a, constructor'
			},
			'record, own key named prototype, a surrogate pair too long': {
				both: 'fail at a',
				ours: 'fail at a, prototype'
			},
			'rest, own key named constructor, a default of a transform to undefined then a check': {
				both: 'fail at a',
				ours: 'fail at a, constructor'
			}
		}
	},
	{
		reason:
			'a class instance given to a `record`, and an `object_with_rest` input that inherits a key, are read by their own keys, so a `union` with such an option of a default that does not match its schema takes it with an `undefined` value, as a copy with the default, where both refuse it, a check after the record reports a key named `prototype`, and an input that comes back still inherits the key: zod refuses the class instance and reads the inherited key, and valibot refuses the default and leaves a key named `prototype` out unread. It follows from going with valibot on the class instance and the inherited key, and with zod on the default, the key named `prototype`, and the missing key of a bare transform',
		status: 'declared',
		docs: 'a class instance given to a `record`, and an `object_with_rest` input that inherits a key, are read by their own keys',
		rows: {
			'union[string, record(default of a wrong value)], class instance, a value undefined': {
				both: 'fail at <root>',
				ours: 'ok {k0: 1}'
			},
			'union[string, rest(default of a wrong value)], an inherited key undefined': {
				both: 'fail at <root>',
				ours: 'ok {a: 1}'
			},
			'union[rest(default of a wrong value), unknown then a transform to "U"], a value undefined, an inherited key wrong':
				{ both: 'ok "U"', ours: 'ok {y: 1}' },
			'union[string, object of a record and a bare transform to undefined], class instance, key missing':
				{ both: 'fail at <root>', ours: 'ok {a: {a: "x", k0: "x"} proto=other}' },
			'union[rest, object], an inherited key wrong': {
				both: 'ok {}',
				ours: 'ok {} proto=other'
			},
			'a check after a record, class instance, own key named prototype, wrong': {
				both: 'fail at <root>',
				ours: 'fail at prototype'
			}
		}
	},
	{
		reason:
			'a symbol key of a `record` input is left unread, so a `union` with a record option of a default that does not match its schema takes the input with an `undefined` value, as a copy with the default, where both refuse it: zod refuses the symbol key, and valibot the default. It follows from going with valibot on the symbol key, and with zod on the default',
		status: 'declared',
		docs: 'a symbol key of a `record` input is left unread',
		rows: {
			'union[string, record(default of a wrong value)], a value undefined, a symbol key': {
				both: 'fail at <root>',
				ours: 'ok {k0: 1}'
			}
		}
	},
	{
		reason: 'an entry named `__proto__` is not guarded, so an input that comes back keeps the key',
		status: 'declared',
		docs: 'an input that comes back keeps its own `__proto__` key',
		rows: {
			'entry named __proto__, own / *': { both: 'ok {a: "x"}', ours: 'ok {a: "x", __proto__: "p"}' }
		}
	},
	{
		reason:
			"`record` validates the value of every own key, so that of an own `__proto__` key too, before leaving the key out of a copy, where both drop it unread: the stricter answer, and the Rust crate's",
		status: 'declared',
		docs: '`record` validates the value of an own `__proto__` key',
		rows: {
			'record, own __proto__ key whose value is wrong': {
				both: 'ok {a: 1}',
				ours: 'fail at __proto__'
			},
			// and a value after it that changes, where the copy leaves the key out
			'record, own __proto__ key whose value is wrong, then a value that changes': {
				both: 'ok {a: 2}',
				ours: 'fail at __proto__'
			},
			// and as an option of a union, which reports one issue at its own path
			'union[string, record], own __proto__ key whose value is wrong': {
				both: 'ok {a: 1}',
				ours: 'fail at <root>'
			},
			// and a check after it, which a pipe that stops at its first failing step doesn't run
			'a check after a record, own __proto__ key whose value is wrong': {
				both: 'fail at <root>',
				ours: 'fail at __proto__'
			},
			// and as an option of a union, which goes on to the next: the matrix case
			// of the rename path of the differential's `record_own_proto`, with no
			// row of the same behavior through other wrappers
			'union[record, check then a transform to null], own __proto__ key whose value is wrong': {
				both: 'ok {}',
				ours: 'ok null'
			},
			// and with a value of it this library refuses, as zod does, and valibot
			// takes, so where the key is renamed the two disagree
			'union[record(number), transform to undefined], own __proto__ key whose value is Infinity': {
				both: 'ok {}',
				ours: 'ok undefined'
			},
			// and to a later option that returns the input as it is, keeping the key
			'union[record, unknown], own __proto__ key whose value is wrong': {
				both: 'ok {}',
				ours: 'ok {__proto__: "x"}'
			}
		}
	},
	{
		reason:
			'an enumerable key the input inherits is still read through a `record` input that comes back, unvalidated, where a copy has only the own keys',
		status: 'declared',
		docs: 'An enumerable key the input inherits is still read through an input that comes back',
		rows: {
			'record, inherited key': { both: 'ok {a: 1}', ours: 'ok {a: 1} proto=other' }
		}
	},
	{
		reason:
			'a hole of an array stays a hole in an array that comes back, where both write `undefined`',
		status: 'declared',
		docs: 'a hole stays a hole',
		rows: {
			'array of optionals, a hole': {
				both: 'ok ["x", undefined, "y"]',
				ours: 'ok ["x", <hole>, "y"]'
			}
		}
	},
	{
		reason:
			'a copy of an array is a `slice`, so a hole before the first item that changed stays a hole in it, where both write `undefined`',
		status: 'declared',
		docs: 'a hole before the first item that changed stays a hole in it',
		rows: {
			'array of optionals, a hole before an item that changes': {
				both: 'ok [undefined, "x!"]',
				ours: 'ok [<hole>, "x!"]'
			}
		}
	},
	{
		reason: 'an array that comes back keeps its own keys that are not items, where a copy has none',
		status: 'declared',
		docs: 'its own keys that are not items stay',
		rows: {
			'array with another key': { both: 'ok ["x"]', ours: 'ok ["x"] with {z: 1}' }
		}
	},
	{
		reason:
			"a copy of an array is a `slice`, so an instance of the input's `Array` subclass, where both give a plain array",
		status: 'declared',
		docs: "it is an instance of the input's `Array` subclass",
		rows: {
			'array of a subclass, an item changes': { both: 'ok ["x!"]', ours: 'ok ["x!"] proto=other' }
		}
	},
	{
		reason:
			"a failed `union` reports one issue, at its own path, where both report the issues of only one option that has the input's type at every depth and fails only a check inside, at their paths. By design: options are only probed, so one that fails builds no issue and allocates nothing",
		status: 'declared',
		docs: 'A failed `union` reports one issue, at its own path',
		rows: {
			'union, an object option fails a check inside': { both: 'fail at a', ours: 'fail at <root>' },
			'union in an object, an object option fails a check inside': {
				both: 'fail at u.a',
				ours: 'fail at u'
			},
			'union, an array option fails a check inside': {
				both: 'fail at [0]',
				ours: 'fail at <root>'
			},
			'union, a record option fails a check inside': { both: 'fail at k', ours: 'fail at <root>' }
		}
	},
	{
		reason:
			'a `pipe` stops at its first failing step, so a check after a container whose item fails only a check is not run, where both run it and report it too. By design: a step runs only on a value every step before it accepted',
		status: 'declared',
		docs: 'A `pipe` stops at its first failing step',
		rows: {
			'a check after an object whose entry fails a check': {
				both: 'fail at <root>, a',
				ours: 'fail at a'
			},
			'a check after an array whose item fails a check': {
				both: 'fail at <root>, [0]',
				ours: 'fail at [0]'
			},
			'a check after a record whose value fails a check': {
				both: 'fail at <root>, k',
				ours: 'fail at k'
			}
		}
	}
] as const satisfies ReadonlyArray<ConformanceDifference>;

/** Where zod and valibot agree and this library differs. */
export const DIFFERENCES: ReadonlyArray<ConformanceDifference> = differences;

/** A declared row of `DIFFERENCES`, as the table writes it. */
export type ConformanceDifferencesRow = DifferenceRows<(typeof differences)[number]>;

// the keys of the rows of each difference, distributed over the union
type DifferenceRows<T> = T extends { status: 'declared'; rows: infer R } ? keyof R & string : never;

export interface ConformanceSide {
	/** Whose result this library's is, as `is_same_result` tells. */
	side: 'zod' | 'valibot' | 'neither' | 'both';
	zod: string;
	valibot: string;
	/** This library's result, where it isn't the text of its side's. Always given for `neither`. */
	ours?: string;
}

// the table, its row names kept as the type `ConformanceSidesRow`
const sides = {
	// arrays given to object and record schemas: valibot takes one as an object.
	// The first is a refusal by all three, which differ in the path
	'array / *': { side: 'zod', zod: 'fail at <root>', valibot: 'fail at a' },
	'array with the keys / *': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {a: "x"}' },
	'array, all entries optional / *': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {}' },
	'empty schema, array / *': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {}' },
	'schema names length, array / *': {
		side: 'zod',
		zod: 'fail at <root>',
		valibot: 'ok {length: 0}'
	},
	'record, array': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {}' },
	'variant, array': { side: 'zod', zod: 'fail at <root>', valibot: 'fail at t' },
	'variant, array with the key': {
		side: 'zod',
		zod: 'fail at <root>',
		valibot: 'ok {t: "b", d: "D"}'
	},
	'rest, array': { side: 'zod', zod: 'fail at <root>', valibot: 'fail at a' },
	'rest, array with the key': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {a: "x"}' },
	'rest, array, empty schema': { side: 'zod', zod: 'fail at <root>', valibot: 'ok {0: 1}' },

	// a discriminator that is missing, of an option that has other entries:
	// valibot stops at the discriminator
	'variant, a literal(undefined) discriminator, key missing, an entry wrong': {
		side: 'zod',
		zod: 'fail at t, x',
		valibot: 'fail at t'
	},

	// the unknown keys of a loose object. An enumerable one the input inherits
	// zod copies and valibot drops: a copy here drops it, and an input that
	// comes back is neither's, as the key is still read through it, and not as
	// an own key
	'unknown inherited key / loose': {
		side: 'neither',
		zod: 'ok {a: "x", z: 1}',
		valibot: 'ok {a: "x"}',
		ours: 'ok {a: "x"} proto=other'
	},
	'default + unknown inherited key / loose': {
		side: 'valibot',
		zod: 'ok {a: "x", d: "D", z: 1}',
		valibot: 'ok {a: "x", d: "D"}'
	},
	'unknown key named constructor / loose': {
		side: 'zod',
		zod: 'ok {a: "x", constructor: 1}',
		valibot: 'ok {a: "x"}'
	},
	'unknown key named prototype / loose': {
		side: 'zod',
		zod: 'ok {a: "x", prototype: 1}',
		valibot: 'ok {a: "x"}'
	},
	'default + unknown key named constructor / loose': {
		side: 'zod',
		zod: 'ok {a: "x", d: "D", constructor: 1}',
		valibot: 'ok {a: "x", d: "D"}'
	},
	// and beside a default zod fills in as it is, and valibot runs through its
	// schema
	'loose, a default of a transform, an unknown key named constructor': {
		side: 'zod',
		zod: 'ok {d: "x", constructor: 1}',
		valibot: 'ok {d: "T"}'
	},
	// and beside a default of `undefined`, whose missing key zod writes and
	// valibot leaves out: neither's, with zod on the key and valibot on the
	// default
	'loose, a default of undefined, an unknown key named constructor': {
		side: 'neither',
		zod: 'ok {d: undefined, constructor: 1}',
		valibot: 'ok {}',
		ours: 'ok {constructor: 1}'
	},
	'default + unknown key named prototype / loose': {
		side: 'zod',
		zod: 'ok {a: "x", d: "D", prototype: 1}',
		valibot: 'ok {a: "x", d: "D"}'
	},

	// the other keys of an object with a rest. An own key named `constructor` or
	// `prototype` valibot leaves out unread, and zod validates, as here
	'rest, own key named constructor': {
		side: 'zod',
		zod: 'ok {a: "x", constructor: 1}',
		valibot: 'ok {a: "x"}'
	},
	'rest, own key named prototype': {
		side: 'zod',
		zod: 'ok {a: "x", prototype: 1}',
		valibot: 'ok {a: "x"}'
	},
	'rest, own key named constructor, wrong': {
		side: 'zod',
		zod: 'fail at constructor',
		valibot: 'ok {a: "x"}'
	},
	'rest, own key named prototype, wrong': {
		side: 'zod',
		zod: 'fail at prototype',
		valibot: 'ok {a: "x"}'
	},
	'rest, a default, own key named constructor': {
		side: 'zod',
		zod: 'ok {a: "x", d: "D", constructor: 1}',
		valibot: 'ok {a: "x", d: "D"}'
	},
	// an enumerable key the input inherits zod validates and copies, and valibot
	// neither, as here: a copy leaves it out, and an input that comes back is
	// neither's, as the key is still read through it, as for a loose object
	'rest, a default, inherited key': {
		side: 'valibot',
		zod: 'ok {a: "x", d: "D", z: 1}',
		valibot: 'ok {a: "x", d: "D"}'
	},
	'rest, a default, inherited key, wrong': {
		side: 'valibot',
		zod: 'fail at z',
		valibot: 'ok {a: "x", d: "D"}'
	},
	'rest, inherited key': {
		side: 'neither',
		zod: 'ok {a: "x", z: 1}',
		valibot: 'ok {a: "x"}',
		ours: 'ok {a: "x"} proto=other'
	},
	'rest, inherited key, wrong': {
		side: 'neither',
		zod: 'fail at z',
		valibot: 'ok {a: "x"}',
		ours: 'ok {a: "x"} proto=other'
	},

	// an optional key under another schema: valibot needs the key
	'union[string, optional(number)] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'union[unknown, optional(string)] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'union[literal(undefined), optional(string)] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	// an option that fills a missing key in makes it optional, as in zod, so one
	// before it that needs the key is tried on the `undefined`, and the first
	// that matches is the union's, where valibot needs the key. An `undefined`
	// it gives leaves the key out, where zod writes it, as a missing key whose
	// entry gives `undefined` stays out of the output wherever it is
	'union[unknown, default] entry, key missing / *': {
		side: 'neither',
		zod: 'ok {a: undefined}',
		valibot: 'fail at a',
		ours: 'ok {}'
	},
	'union[unknown then a transform to "U", default] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "U"}',
		valibot: 'fail at a'
	},
	// and the same of a `memo_union`
	'memo_union[unknown, default] entry, key missing / *': {
		side: 'neither',
		zod: 'ok {a: undefined}',
		valibot: 'fail at a',
		ours: 'ok {}'
	},
	'memo_union[unknown then a transform to "U", default] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "U"}',
		valibot: 'fail at a'
	},
	// before an option that leaves the key `undefined` none is tried again, and
	// the key stays out, as in zod
	'union[unknown then a transform to "U", optional(string)] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	// the first option matches, a pipe that starts with an `optional`, whose
	// steps run under a `union` and whose transform's value is kept, as in
	// `union[number, optional(string) then a transform to "T"]`, where zod keeps
	// it too. Here zod leaves the key out, as another option lets it be missing
	'union[optional(string) then a transform to "T", optional(number)] entry, key missing / *': {
		side: 'neither',
		zod: 'ok {}',
		valibot: 'fail at a',
		ours: 'ok {a: "T"}'
	},
	// where the first option that matches a missing key gives `undefined`, none
	// is tried again and the key stays out, where zod tries the options before
	// it again when any option is a default, a default inside another union
	// among them, or when a transform follows the union, and keeps what they
	// give
	'union[unknown then a transform to "U", optional(string), default] entry, key missing / *': {
		side: 'neither',
		zod: 'ok {a: "U"}',
		valibot: 'fail at a',
		ours: 'ok {}'
	},
	'union[unknown then a transform to "U", optional(string)] then a transform entry, key missing / *':
		{
			side: 'neither',
			zod: 'ok {a: "U"}',
			valibot: 'fail at a',
			ours: 'ok {}'
		},
	'union[unknown then a transform to "U", default(optional(string), undefined)] entry, key missing / *':
		{
			side: 'neither',
			zod: 'ok {a: "U"}',
			valibot: 'fail at a',
			ours: 'ok {}'
		},
	// a union that fills the key in gives the one around it `undefined` when an
	// option before its default matches, and the outer tries none again, where
	// the same options in one union try the first again, as zod does for both
	'union[unknown then a transform to "U", union[string, unknown, default]] entry, key missing / *':
		{
			side: 'neither',
			zod: 'ok {a: "U"}',
			valibot: 'fail at a',
			ours: 'ok {}'
		},
	'union[unknown then a transform to "U", string, unknown, default] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "U"}',
		valibot: 'fail at a'
	},
	'nullable(optional(string)) entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'lazy(optional(string)) entry, key missing / *': {
		side: 'zod',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'nullable(default) entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "D"}',
		valibot: 'fail at a'
	},
	'lazy(default) entry, key missing / *': { side: 'zod', zod: 'ok {a: "D"}', valibot: 'fail at a' },
	// valibot's has a schema before it, which needs the key
	'bare transform entry, key missing / *': { side: 'zod', zod: 'ok {}', valibot: 'fail at a' },
	'bare transform to "T" entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'fail at a'
	},
	// and one under a union, a nullable, or a lazy, which zod runs on the
	// missing key, where valibot needs it
	'union[string, bare transform to "T"] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'fail at a'
	},
	'nullable(bare transform to "T") entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'fail at a'
	},
	'lazy(bare transform to "T") entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'fail at a'
	},
	// and a pipe that starts with one, whose steps zod runs on what it gives
	'transform to "T" then a transform entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T!"}',
		valibot: 'fail at a'
	},

	// a length check after an array whose item is wrong. zod checks the length
	// of an array too long before its items, and reports only that, and the
	// length of one too short after them, and reports both: valibot reports
	// the item, as here, where the pipe stops
	'a max_length after an array too long, an item wrong': {
		side: 'valibot',
		zod: 'fail at <root>',
		valibot: 'fail at [0]'
	},
	'a min_length after an array too short, an item wrong': {
		side: 'valibot',
		zod: 'fail at <root>, [0]',
		valibot: 'fail at [0]'
	},
	// the length of a string: zod's `max_length` counts a surrogate pair as
	// one, and valibot's counts UTF-16 code units, as `length` does here
	'max_length, a string of a surrogate pair': {
		side: 'valibot',
		zod: 'ok "\uD83D\uDE00"',
		valibot: 'fail at <root>'
	},

	// a check after an object with an unknown key: valibot stops at the unknown
	// key, as here, and zod runs the check and reports it beside the key
	'a check after an object with an unknown key': {
		side: 'valibot',
		zod: 'fail at <root> +unknown keys in <root>',
		valibot: 'fail +unknown keys in <root>'
	},
	// and after an object whose missing key is an `unknown`'s, then a check
	// that fails: valibot refuses the key and stops, as here, and zod runs the
	// entry's check on the `undefined`, and the check after the object
	'a check after an object of unknown then a check that fails, key missing': {
		side: 'valibot',
		zod: 'fail at <root>, a',
		valibot: 'fail at a'
	},

	// steps after an optional, with the key missing: valibot runs none and
	// leaves the key out, as here. zod runs them on the `undefined`, keeps what a
	// transform gave, and reports a step that fails beside one
	'optional(string) then a transform to "T" entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: "T"}',
		valibot: 'ok {}'
	},
	'message(optional(string)) then a transform to "T" entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: "T"}',
		valibot: 'ok {}'
	},
	'optional(string) then a check, then a transform to "T" entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: "T"}',
		valibot: 'ok {}'
	},
	'optional(default) then a transform to "T" entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: "T"}',
		valibot: 'ok {}'
	},
	'optional(string) then a transform, then a check that fails entry, key missing / *': {
		side: 'valibot',
		zod: 'fail at a',
		valibot: 'ok {}'
	},
	// as it does under a `message`, which hands it that it is the entry itself
	'message(optional(string) then a transform, then a check that fails) entry, key missing / *': {
		side: 'valibot',
		zod: 'fail at a',
		valibot: 'ok {}'
	},
	// under a schema that hands it the object and the key and not that, the
	// steps run on the `undefined`: a step that fails is reported, as valibot
	// refuses the key, and what a transform gives is kept, as in zod
	'nullable(optional(string) then a check that fails) entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'union[number, optional(string) then a check that fails] entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'nullable(message(optional(string) then a check that fails)) entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'message(nullable(optional(string) then a check that fails)) entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'lazy(optional(string) then a transform to "T") entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'fail at a'
	},
	'union[number, optional(string) then a transform to "T"] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'fail at a'
	},
	// after a nullable, a lazy, or a union that reaches an optional, and after
	// a default of `undefined`, the steps run on the `undefined`: a transform's
	// output is kept, as in zod, and a failure is reported, which zod drops
	'nullable(optional(string)) then a check that fails entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'nullable(optional(string)) then a transform to "T" entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'fail at a'
	},
	'lazy(optional(string)) then a check that fails entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'lazy(optional(string)) then a transform to "T" entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'fail at a'
	},
	'union[number, optional(string)] then a check that fails entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {}',
		valibot: 'fail at a'
	},
	'union[number, optional(string)] then a transform to "T" entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'fail at a'
	},
	'default of undefined then a check that fails entry, key missing / *': {
		side: 'zod',
		zod: 'fail at a',
		valibot: 'ok {}'
	},
	'default of undefined then a transform to "T" entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "T"}',
		valibot: 'ok {}'
	},

	// a default under an optional, and a default of `undefined`: zod fills them in
	'optional(default) entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: "D"}',
		valibot: 'ok {}'
	},
	'optional(default) entry, key undefined / *': {
		side: 'valibot',
		zod: 'ok {a: "D"}',
		valibot: 'ok {a: undefined}'
	},
	// and a default the optional holds under a nullable or a lazy
	'optional(nullable(default)) entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: "D"}',
		valibot: 'ok {}'
	},
	'optional(nullable(default)) entry, key undefined / *': {
		side: 'valibot',
		zod: 'ok {a: "D"}',
		valibot: 'ok {a: undefined}'
	},
	'optional(lazy(default)) entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: "D"}',
		valibot: 'ok {}'
	},
	'optional(lazy(default)) entry, key undefined / *': {
		side: 'valibot',
		zod: 'ok {a: "D"}',
		valibot: 'ok {a: undefined}'
	},
	'default of undefined entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: undefined}',
		valibot: 'ok {}'
	},
	// and of a schema that reaches another default, as itself or as an option
	// of a union, which zod doesn't run on its `undefined`
	'default of undefined of a default entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: undefined}',
		valibot: 'ok {}'
	},
	'default of undefined of union[number, default] entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: undefined}',
		valibot: 'ok {}'
	},
	// a pipe that starts with one leaves the key out when its steps give
	// `undefined`, as valibot does here, where zod writes it
	'default of undefined then a transform to undefined entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: undefined}',
		valibot: 'ok {}'
	},
	// a default whose steps give `undefined`, under a schema that lets the key
	// be missing in zod and not in valibot: the key stays out, as it does for
	// the pipe as the entry itself, where zod writes it and valibot refuses the
	// missing key
	'nullable(default then a transform to undefined) entry, key missing / *': {
		side: 'neither',
		zod: 'ok {a: undefined}',
		valibot: 'fail at a',
		ours: 'ok {}'
	},
	'lazy(default then a transform to undefined) entry, key missing / *': {
		side: 'neither',
		zod: 'ok {a: undefined}',
		valibot: 'fail at a',
		ours: 'ok {}'
	},
	'union[number, default then a transform to undefined] entry, key missing / *': {
		side: 'neither',
		zod: 'ok {a: undefined}',
		valibot: 'fail at a',
		ours: 'ok {}'
	},

	// a default that doesn't match its schema: zod fills it in as it is, as
	// here, and valibot runs it through the schema
	'default of a wrong value entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: 5}',
		valibot: 'fail at a'
	},
	'default of a wrong value entry, key undefined / *': {
		side: 'zod',
		zod: 'ok {a: 5}',
		valibot: 'fail at a'
	},
	'default_fn of a wrong value entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: 5}',
		valibot: 'fail at a'
	},
	'default_fn of a wrong value entry, key undefined / *': {
		side: 'zod',
		zod: 'ok {a: 5}',
		valibot: 'fail at a'
	},
	// and beside a default of `undefined`, whose missing key zod writes and
	// valibot leaves out: neither's, with zod on the one and valibot on the
	// other
	'a default of a wrong value entry and a default of undefined entry, keys missing / *': {
		side: 'neither',
		zod: 'ok {a: 1, d: undefined}',
		valibot: 'fail at a',
		ours: 'ok {a: 1}'
	},
	// a value given to a default whose schema gives `undefined`: zod fills the
	// default in, and valibot keeps the `undefined`, as here
	'a default of a transform to undefined then a check, a value given': {
		side: 'valibot',
		zod: 'ok "x"',
		valibot: 'fail at <root>'
	},
	'default_fn of a string then a transform entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "D"}',
		valibot: 'ok {a: "D!"}'
	},
	'default_fn of a string then a transform entry, key undefined / *': {
		side: 'zod',
		zod: 'ok {a: "D"}',
		valibot: 'ok {a: "D!"}'
	},
	// so what it makes is filled in as it is, the one made, where valibot's
	// array schema copies it
	'default_fn of an array entry, the one made': {
		side: 'zod',
		zod: 'ok true',
		valibot: 'ok false'
	},
	// a default made by a function, under another schema, as a `with_default` is
	'optional(default_fn) entry, key missing / *': {
		side: 'valibot',
		zod: 'ok {a: "D"}',
		valibot: 'ok {}'
	},
	'optional(default_fn) entry, key undefined / *': {
		side: 'valibot',
		zod: 'ok {a: "D"}',
		valibot: 'ok {a: undefined}'
	},
	'nullable(default_fn) entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "D"}',
		valibot: 'fail at a'
	},
	'lazy(default_fn) entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "D"}',
		valibot: 'fail at a'
	},
	'union[unknown, default_fn] entry, key missing / *': {
		side: 'neither',
		zod: 'ok {a: undefined}',
		valibot: 'fail at a',
		ours: 'ok {}'
	},
	'union[unknown then a transform to "U", default_fn] entry, key missing / *': {
		side: 'zod',
		zod: 'ok {a: "U"}',
		valibot: 'fail at a'
	},

	// an entry named `__proto__`: zod neither reads nor writes it. The others
	// read `Object.prototype` for it when the input lacks the key, and set the
	// output's prototype by writing it
	'entry named __proto__, missing / *': {
		side: 'valibot',
		zod: 'ok {a: "x"}',
		valibot: 'fail at __proto__'
	},
	'entry named __proto__, own object, beside a default / *': {
		side: 'valibot',
		zod: 'ok {d: "D"}',
		valibot: 'ok {d: "D"} proto=other'
	},

	// what a record is given: zod refuses a symbol key, whatever its value, and a
	// class instance
	'record, symbol key': {
		side: 'valibot',
		zod: 'fail at Symbol(sym)',
		valibot: 'ok {a: 1}',
		ours: 'ok {a: 1, Symbol(sym): "x"}'
	},
	'record, symbol key whose value is right': {
		side: 'valibot',
		zod: 'fail at Symbol(sym)',
		valibot: 'ok {a: 1}',
		ours: 'ok {a: 1, Symbol(sym): 2}'
	},
	// an own key of a record named `constructor` or `prototype`: valibot leaves it
	// out unread, and zod validates it, as here
	'record, own key named constructor': {
		side: 'zod',
		zod: 'ok {a: 1, constructor: 2}',
		valibot: 'ok {a: 1}'
	},
	'record, own key named constructor, wrong': {
		side: 'zod',
		zod: 'fail at constructor',
		valibot: 'ok {a: 1}'
	},
	'record, own key named prototype, wrong': {
		side: 'zod',
		zod: 'fail at prototype',
		valibot: 'ok {a: 1}'
	},
	'record, class instance': {
		side: 'valibot',
		zod: 'fail at <root>',
		valibot: 'ok {a: "x"}',
		ours: 'ok {a: "x"} proto=other'
	},

	// the infinities, which valibot's `number` takes: zod's refuses them, as here
	'number, Infinity': { side: 'zod', zod: 'fail at <root>', valibot: 'ok Infinity' },
	'number, -Infinity': { side: 'zod', zod: 'fail at <root>', valibot: 'ok -Infinity' },
	'number, 1e999 parsed': { side: 'zod', zod: 'fail at <root>', valibot: 'ok Infinity' },
	'number entry, -1e999 parsed / *': {
		side: 'zod',
		zod: 'fail at a',
		valibot: 'ok {a: -Infinity}'
	},
	'array of numbers, an Infinity': {
		side: 'zod',
		zod: 'fail at [1]',
		valibot: 'ok [1, Infinity]'
	}
} satisfies Record<string, ConformanceSide>;

/** A row of `SIDES`, as the table writes it. */
export type ConformanceSidesRow = keyof typeof sides;

/** Where zod and valibot disagree: which of them this library goes with. */
export const SIDES: Record<ConformanceSidesRow, ConformanceSide> = sides;

/**
 * What arktype and typebox did with the cases that name them in `also`.
 * They are not part of the rule: nothing here is right or wrong, and the
 * results are pinned so that an upgrade which changes one shows. Of a refusal
 * only the verdict is kept. typebox has no object that drops unknown keys.
 */
export const INFORMATIONAL: Record<string, Partial<Record<InformationalLibName, string>>> = {
	'exact / strip': { arktype: 'ok {a: "x", b: "y"}' },
	'exact / strict': { arktype: 'ok {a: "x", b: "y"}', typebox: 'ok {a: "x", b: "y"}' },
	'exact / loose': { arktype: 'ok {a: "x", b: "y"}', typebox: 'ok {a: "x", b: "y"}' },
	'optional missing / strip': { arktype: 'ok {a: "x"}' },
	'optional missing / strict': { arktype: 'ok {a: "x"}', typebox: 'ok {a: "x"}' },
	'optional missing / loose': { arktype: 'ok {a: "x"}', typebox: 'ok {a: "x"}' },
	// arktype's optional key may be missing and may not be `undefined`
	'optional undefined / strip': { arktype: 'fail' },
	'optional undefined / strict': { arktype: 'fail', typebox: 'ok {a: "x", b: undefined}' },
	'optional undefined / loose': { arktype: 'fail', typebox: 'ok {a: "x", b: undefined}' },
	'required missing / strip': { arktype: 'fail' },
	'required missing / strict': { arktype: 'fail', typebox: 'fail' },
	'required missing / loose': { arktype: 'fail', typebox: 'fail' },
	'unknown key / strip': { arktype: 'ok {a: "x"}' },
	'unknown key / strict': { arktype: 'fail', typebox: 'fail' },
	'unknown key / loose': { arktype: 'ok {a: "x", z: 1}', typebox: 'ok {a: "x", z: 1}' },
	'array / strip': { arktype: 'fail' },
	'array / strict': { arktype: 'fail', typebox: 'fail' },
	'array / loose': { arktype: 'fail', typebox: 'fail' },
	'empty schema, empty object / strip': { arktype: 'ok {}' },
	'empty schema, empty object / strict': { arktype: 'ok {}', typebox: 'ok {}' },
	'empty schema, empty object / loose': { arktype: 'ok {}', typebox: 'ok {}' },
	'default missing / *': { arktype: 'ok {a: "x", d: "D"}' },
	'default + unknown key / strip': { arktype: 'ok {a: "x", d: "D"}' },
	'default + unknown key / strict': { arktype: 'fail' },
	// a copy of the input with the default after it, so in the input's order
	'default + unknown key / loose': { arktype: 'ok {z: 1, a: "x", d: "D"}' },
	rest: { typebox: 'ok {a: "x", z: 1}' },
	'rest, a key wrong': { typebox: 'fail' },
	'rest, array': { typebox: 'fail' }
};

/**
 * A table by row, its ` / *` keys written out.
 *
 * @throws Error - when a row is in the table twice
 */
export const expand_conformance_table = <TValue>(
	table: Record<string, TValue>
): Map<string, TValue> => {
	const by_row: Map<string, TValue> = new Map();
	for (const [key, value] of Object.entries(table)) {
		const names = key.endsWith(' / *')
			? CONFORMANCE_FLAVORS.map((flavor) => key.slice(0, -1) + flavor)
			: [key];
		for (const name of names) {
			if (by_row.has(name)) throw Error(`"${name}" is in a table twice`);
			by_row.set(name, value);
		}
	}
	return by_row;
};
