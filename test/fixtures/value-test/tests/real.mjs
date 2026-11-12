import assert from 'node:assert/strict';
import { add, isEven } from '../src/math.mjs';
assert.equal(add(2, 3), 5);
assert.equal(isEven(4), true);
assert.equal(isEven(3), false);
