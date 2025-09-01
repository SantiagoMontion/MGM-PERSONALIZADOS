import assert from 'node:assert';
import { cmToPxAtDpi, mmToCm } from './units.js';
import { clampZoom } from './canvas-utils.js';

assert.strictEqual(mmToCm(10), 1);
assert.strictEqual(cmToPxAtDpi(2.54, 300), 300);
assert.strictEqual(clampZoom(0.1), 0.25);
assert.strictEqual(clampZoom(10), 4);
assert.strictEqual(clampZoom(1), 1);

console.log('canvas-utils tests passed');
