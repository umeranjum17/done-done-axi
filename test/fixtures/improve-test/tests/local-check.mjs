import assert from 'node:assert/strict';
import { isEven } from '../src/math.mjs';
assert.equal(isEven(4), true);
assert.equal(isEven(3), false);
