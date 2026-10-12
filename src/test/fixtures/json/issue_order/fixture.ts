import * as s from '#lib/schema.ts';
import type { JsonFixture } from '../json_test_helpers.ts';

// issues come in the order the failures are met: an object's entries in its
// own order, which puts the array indices first whatever order they were given
// in, then its unknown keys in the input's, which does the same, and each
// container's before whatever follows it
export const fixture: JsonFixture = {
	schema: s.object({
		b: s.string,
		10: s.number,
		a: s.object({
			z: s.number,
			1: s.string,
			y: s.array(s.object({ x: s.number, 2: s.boolean })),
			0: s.optional(s.boolean)
		}),
		2: s.boolean,
		r: s.record(s.pipe(s.number, s.integer)),
		'01': s.number,
		l: s.loose_object({ 5: s.string, c: s.string, 3: s.string }),
		t: s.optional(s.array(s.array(s.number))),
		'4294967295': s.optional(s.number),
		'4294967294': s.optional(s.number)
	}),
	cases: {
		valid:
			'{"b":"x","10":1,"a":{"z":1,"1":"x","y":[{"x":1,"2":true}]},"2":true,"r":{"k":1},"01":1,"l":{"5":"","c":"","3":""}}',
		empty: '{}',
		every_entry_wrong:
			'{"b":1,"10":"x","a":[],"2":2,"r":null,"01":"x","l":"l","t":{},"4294967295":"x","4294967294":"x"}',
		every_entry_wrong_reversed:
			'{"4294967294":"x","4294967295":"x","t":{},"l":"l","01":"x","r":null,"2":2,"a":[],"10":"x","b":1}',
		entries_then_unknown_keys:
			'{"zz":1,"7":null,"b":1,"10":"x","a":{"z":1,"1":"x","y":[]},"2":2,"r":{},"01":"x","-1":{},"l":{"5":"","c":"","3":""},"4294967296":1,"3":[],"00":true,"1e3":"x","":0}',
		only_unknown_keys: '{"z":1,"y":"x","100":null,"x":[],"9":{},"w":true}',
		nested:
			'{"b":"x","10":1,"a":{"q":1,"0":[],"y":[{"x":"1","2":1,"9":0},3,{"w":1},{"2":true,"x":1}],"z":"z","8":null},"2":true,"r":{},"01":1,"l":{}}',
		record_in_key_order:
			'{"b":"x","10":1,"a":{"z":1,"1":"x","y":[]},"2":true,"r":{"k":1.5,"3":"x","j":null,"1":2,"0":0.5,"-1":[],"i":3},"01":1,"l":{"5":"","c":"","3":""}}',
		loose_entries: '{"l":{"c":1,"extra":1,"3":null,"0":[]}}',
		arrays: '{"t":[[1,"a"],"b",[null,2,[]],[],{"0":1},[3]]}',
		everything:
			'{"zz":1,"t":[["a"],1],"l":{"3":3},"01":null,"r":{"b":"x","a":1.5,"1":[]},"2":"2","a":{"y":[{},[]],"1":1,"z":"z","k":0},"10":[],"b":{},"0":0}',
		// a key written twice is at its first place, with its last value
		duplicate_unknown_keys: '{"y":1,"x":2,"y":[],"5":"a","x":null,"5":{}}',
		duplicate_entries: '{"b":"x","2":"x","b":1,"10":1,"2":null,"10":[]}',
		duplicate_nested: '{"a":{"y":[1],"z":"z","y":[{"x":1,"2":1,"x":"x"}],"q":1,"q":"q"}}'
	}
};
