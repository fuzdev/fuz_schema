import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

const Uuid = s.pipe(s.string, s.uuid);
const Datetime = s.pipe(s.string, s.iso_datetime);

// the format tests as entries, items, and options of a union, whose options a
// string reaches through their pipes and an object through the object option
export const fixture: JsonFixture = {
	schema: s.object({
		id: Uuid,
		at: s.optional(Datetime),
		ids: s.array(Uuid),
		either: s.union([Uuid, Datetime, s.number]),
		ref: s.union([s.object({ id: Uuid }), Datetime])
	}),
	cases: {
		valid:
			'{"id":"123e4567-e89b-42d3-a456-426614174000","at":"2024-01-01T00:00:00Z","ids":[],"either":1,"ref":"2024-01-01T00:00:00Z"}',
		at_missing:
			'{"id":"123e4567-e89b-42d3-a456-426614174000","ids":["00000000-0000-0000-0000-000000000000"],"either":"2024-01-01T00:00:00Z","ref":{"id":"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"}}',
		either_uuid:
			'{"id":"123e4567-e89b-42d3-a456-426614174000","ids":[],"either":"123e4567-e89b-42d3-a456-426614174000","ref":"2024-01-01T00:00:00Z"}',
		every_entry_wrong:
			'{"id":"123e4567-e89b-02d3-a456-426614174000","at":"2024-02-30T00:00:00Z","ids":["x","123e4567-e89b-42d3-a456-426614174000","y"],"either":"x","ref":{"id":"2024-01-01T00:00:00Z"}}',
		either_a_non_string:
			'{"id":"123e4567-e89b-42d3-a456-426614174000","ids":[],"either":true,"ref":"2024-01-01T00:00:00Z"}',
		ref_an_offset:
			'{"id":"123e4567-e89b-42d3-a456-426614174000","ids":[],"either":1,"ref":"2024-01-01T00:00:00+01:00"}',
		id_a_number: '{"id":1,"ids":[],"either":1,"ref":"2024-01-01T00:00:00Z"}',
		id_missing: '{"ids":[],"either":1,"ref":"2024-01-01T00:00:00Z"}',
		ids_an_object:
			'{"id":"123e4567-e89b-42d3-a456-426614174000","ids":{"0":"123e4567-e89b-42d3-a456-426614174000"},"either":1,"ref":"2024-01-01T00:00:00Z"}',
		ref_an_array:
			'{"id":"123e4567-e89b-42d3-a456-426614174000","ids":[],"either":1,"ref":["2024-01-01T00:00:00Z"]}'
	}
};
