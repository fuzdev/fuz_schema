# Formats

`uuid` and `iso_datetime` are refinements of a string, used in a `pipe`:

```ts
const Id = s.pipe(s.string, s.uuid);
const CreatedAt = s.pipe(s.string, s.iso_datetime);
```

Each fails with an issue of its own kind, `expected` the kind's name. The
output is the string given, never normalized. Alone, outside a `pipe`, each
refuses any value that isn't a string, and `to_schema_json` refuses it there,
as the crate does.

## The grammars

### `uuid`

```
^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$
```

A UUID of RFC 9562: a version from 1 to 8, the RFC's variant, the nil UUID,
and the max UUID, hex digits of either case. Zod's grammar, with the max UUID
in any case.

### `iso_datetime`

```
^<date>T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$
```

where `<date>` is a date of the Gregorian calendar with a four-digit year:

```
(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))
```

A date and time of RFC 3339 in UTC: ASCII digits, an uppercase `T` and `Z`,
seconds always, a fraction of 1 to 9 digits or none, no offset, no leap
second. Zod's default `iso.datetime()`, with the fraction capped.

## Not formats

There is no `email` or `url`. An email address has no one grammar, and zod's
`z.email()` is one of several, so a `regex` of your own says which you mean.
Zod's `z.url()` trims the text, parses it by WHATWG, and returns it trimmed
with tabs and newlines removed (`url.href` with `normalize`). A byte scan
can't parse by WHATWG, and a format test returns the string given.
fuz_util's `Url` is a `check` of `URL.canParse`.

## Choosing a grammar

Where zod and valibot disagree, a grammar is chosen by these, in order:

1. **Consumer safety.** Never accept what JS `Date`, Temporal, Postgres, or
   the Rust date crates (`time`, chrono, jiff) misread, or refuse by their
   grammar. `Date` reads `2024-02-30` as March 1, so an impossible date is
   refused. Precision a consumer drops, as `Date` keeps milliseconds, is not
   a misreading, and a store's range is not a grammar, below.
2. **The standard** as the outer bound: RFC 9562 for a UUID, RFC 3339 for a
   date and time. Nothing outside it is accepted.
3. **Parity** with the twins that validate the same values, the Rust crate
   among them.
4. **Cost**, in bytes and in time.

The fraction is capped at 9 digits: Temporal refuses a tenth, nanoseconds are
the finest any of them hold, and Postgres rounds to microseconds and refuses
129 digits or more.

Year `0000` is accepted though Postgres refuses it, having no year zero. That
refusal is of a store's range, loud and not a misreading, as a column's own
bounds are. RFC 3339 has the year, `Date` and Temporal read it, and zod and
valibot both accept it.

## How a grammar is held

- **`uuid` reads char codes**, which takes less time than a `RegExp` of its
  grammar, and `src/test/schema.formats.test.ts` holds it to the grammar
  above with every char at every position of a set of UUIDs, every version
  and variant, and every length around 36. `to_json_schema` writes the grammar as its
  `pattern`.
- **The conformance matrix**, `src/test/conformance_cases.ts`, runs each edge
  through zod and valibot. Where they disagree, a `SIDES` row of
  `src/test/conformance_tables.ts` says which this library goes with, and
  [design.md](design.md#behavior-that-differs-from-valibot-and-zod) says why.
  Where they agree, this library does the same.
- **The differential**, `npm run differential`, draws strings and near
  misses of them, and holds each disagreement of zod and valibot to the
  `SIDES` rows that recognize it, see
  [testing.md](testing.md#the-differential).
- **The JSON fixtures**, `src/test/fixtures/json/format_*`, hold the edges as
  texts, so the Rust crate's matchers, byte scans in `format.rs`, give the
  library's verdict and issues on each.
