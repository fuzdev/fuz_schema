import { generate_random_json_fixture } from '../json_generate.ts';

// a random schema and texts aimed at it, see `json_generate.ts`: one that
// draws the format tests
export const fixture = generate_random_json_fixture(0, 1628);
