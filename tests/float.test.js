/*
 * Checks the hand-written engine against the real hardware.
 * Run:  node tests/float.test.js
 * If softAdd ever disagrees with the CPU's own a + b, the explanation on
 * screen would be wrong — so this is the most important file in the repo.
 */
const assert = require('assert');
const F = require('../js/float.js');

let passed = 0;
function check(name, fn) { fn(); passed++; }

// --- Known exact values -----------------------------------------------------
check('0.1 is stored slightly above 0.1', () => {
  assert.strictEqual(F.exactValue(0.1),
    '0.1000000000000000055511151231257827021181583404541015625');
});
check('0.3 is stored slightly below 0.3', () => {
  assert.strictEqual(F.exactValue(0.3),
    '0.299999999999999988897769753748434595763683319091796875');
});
check('0.1 + 0.2 lands on the double above 0.3', () => {
  assert.strictEqual(0.1 + 0.2, F.nextAway(0.3));
});
check('0.5 + 0.25 is exact', () => {
  const r = F.softAdd(0.5, 0.25);
  assert.strictEqual(r.rounding, 'exact');
  assert.strictEqual(r.result, 0.75);
});

// --- Bit layout -------------------------------------------------------------
check('1.0 bit pattern', () => {
  assert.strictEqual(F.bitString(1), '0' + '01111111111' + '0'.repeat(52));
});
check('fromBits inverts toBits', () => {
  for (const x of [0.1, -3.5, 1e-310, 1e308]) assert.strictEqual(F.fromBits(F.toBits(x)), x);
});
check('binary expansion of 0.1 repeats 0011', () => {
  const e = F.binaryExpansion('0.1', 20);
  assert.strictEqual(e.fracBits, '00011001100110011001');
  assert.strictEqual(e.terminates, false);
  assert.strictEqual(F.binaryExpansion('0.375', 20).terminates, true);
});

// --- softAdd must agree with the hardware, bit for bit ----------------------
const view = new DataView(new ArrayBuffer(8));
function randomDouble() {
  // Random bit patterns hit every exponent, subnormals included.
  view.setUint32(0, (Math.random() * 2 ** 32) >>> 0);
  view.setUint32(4, (Math.random() * 2 ** 32) >>> 0);
  return view.getFloat64(0);
}
function randomNearby() {
  // Numbers of similar size: exercises real rounding, not just "big + tiny".
  return (Math.random() - 0.5) * 10 ** Math.floor(Math.random() * 20 - 10);
}

const edge = [0, -0, 1, -1, 0.1, 0.2, 0.3, 0.7, 1e16, 2 ** 53, 2 ** 53 + 2,
  Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 2.2250738585072014e-308,
  Number.EPSILON, 1 - Number.EPSILON / 2];
check('edge cases, every pair', () => {
  for (const a of edge) for (const b of edge) {
    const r = F.softAdd(a, b);
    assert.ok(r.matches, `mismatch for ${a} + ${b}: got ${r.result}, cpu ${a + b}`);
  }
});

check('200 000 random pairs', () => {
  for (let i = 0; i < 100000; i++) {
    let a = randomDouble(), b = randomDouble();
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    let r = F.softAdd(a, b);
    assert.ok(r.matches, `mismatch for ${a} + ${b}`);
    a = randomNearby(); b = randomNearby();
    r = F.softAdd(a, b);
    assert.ok(r.matches, `mismatch for ${a} + ${b}`);
  }
});

check('the kept significand always fits in 53 bits (carry handled)', () => {
  // 1 + (1 − 2^-53): rounding up 53 ones overflows into a 54th bit.
  const r = F.softAdd(1, 1 - 2 ** -53);
  assert.strictEqual(r.carry, true);
  assert.ok(r.kept < 2n ** 53n);
  assert.strictEqual(r.result, 2);
});

check('ties round to even', () => {
  // 2^53 + 1 is exactly halfway between 2^53 and 2^53 + 2 → keeps the even one.
  const r = F.softAdd(2 ** 53, 1);
  assert.strictEqual(r.rounding, 'tie, down to even');
  assert.strictEqual(r.result, 2 ** 53);
});

console.log(`all ${passed} checks passed`);
