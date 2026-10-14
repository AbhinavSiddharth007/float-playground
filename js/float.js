/*
 * float.js — the engine. Reads IEEE 754 doubles bit by bit and re-does
 * addition by hand, step by step, so we can show where the error comes from.
 *
 * A double is 64 bits:  [ sign: 1 ][ exponent: 11 ][ fraction: 52 ]
 * For a "normal" number:   value = (-1)^sign × 1.fraction × 2^(exponent − 1023)
 *
 * Everything that must be exact uses BigInt (arbitrary-size integers),
 * because doing the explanation with floats would hide the very rounding
 * we want to show.
 *
 * No modules on purpose: the page must work by double-clicking index.html
 * (browsers block ES modules on file://). Everything hangs off one global.
 */
(function (global) {
  'use strict';

  const FRAC_BITS = 52n;                  // stored fraction bits
  const PRECISION = 53;                   // 52 stored + 1 hidden leading bit
  const FRAC_MASK = (1n << FRAC_BITS) - 1n;
  const EXP_MASK = 0x7ffn;                // 11 ones
  const BIAS = 1023;
  const MIN_EXP = -1074;                  // smallest subnormal is 2^-1074
  const MAX_EXP = 971;                    // largest finite is (2^53 − 1) × 2^971

  // One 8-byte buffer, two views of the same memory:
  // write the bytes as a float, read them back as a 64-bit integer.
  const view = new DataView(new ArrayBuffer(8));

  /** The raw 64 bits of a double, as an unsigned BigInt. */
  function toBits(x) {
    view.setFloat64(0, x);
    return view.getBigUint64(0);
  }

  /** The reverse: a 64-bit pattern back to the double it encodes. */
  function fromBits(bits) {
    view.setBigUint64(0, bits);
    return view.getFloat64(0);
  }

  /** The 64 bits as a '0'/'1' string, most significant first. */
  function bitString(x) {
    return toBits(x).toString(2).padStart(64, '0');
  }

  /**
   * Split a double into its three fields, and also into an exact
   * integer form:  value = (−1)^sign × significand × 2^exponent
   * where significand is a BigInt with the hidden bit put back.
   */
  function decompose(x) {
    const bits = toBits(x);
    const sign = Number(bits >> 63n);
    const expField = Number((bits >> FRAC_BITS) & EXP_MASK);
    const fraction = bits & FRAC_MASK;

    let kind, significand, exponent;
    if (expField === 0x7ff) {
      // All exponent bits set: not a real number.
      kind = fraction === 0n ? 'infinity' : 'nan';
      significand = 0n;
      exponent = 0;
    } else if (expField === 0) {
      // Exponent field 0: zero or subnormal. No hidden 1, fixed exponent.
      kind = fraction === 0n ? 'zero' : 'subnormal';
      significand = fraction;
      exponent = MIN_EXP;
    } else {
      // Normal: put the hidden leading 1 back in front of the fraction.
      kind = 'normal';
      significand = (1n << FRAC_BITS) | fraction;
      exponent = expField - BIAS - 52;
    }
    return { x, bits, sign, expField, fraction, kind, significand, exponent };
  }

  /**
   * Exact decimal string of  ±sig × 2^exp  (no rounding at all).
   * Trick: 1/2^k = 5^k / 10^k, so a binary fraction always has a finite
   * decimal expansion — we just compute sig × 5^k and place the point.
   */
  function exactDecimal(sig, exp, negative) {
    let s;
    if (sig === 0n) {
      s = '0';
    } else if (exp >= 0) {
      s = (sig << BigInt(exp)).toString();
    } else {
      const k = -exp;
      const digits = (sig * 5n ** BigInt(k)).toString().padStart(k + 1, '0');
      const intPart = digits.slice(0, digits.length - k);
      const fracPart = digits.slice(digits.length - k).replace(/0+$/, '');
      s = fracPart ? intPart + '.' + fracPart : intPart;
    }
    return (negative ? '-' : '') + s;
  }

  /** The exact value a double really holds, as a decimal string. */
  function exactValue(x) {
    if (!Number.isFinite(x)) return String(x);
    const d = decompose(x);
    return exactDecimal(d.significand, d.exponent, d.sign === 1);
  }

  /** The neighbouring doubles: one step away from zero / toward zero. */
  function nextAway(x) { return fromBits(toBits(x) + 1n); }
  function nextToward(x) { return x === 0 ? 0 : fromBits(toBits(x) - 1n); }

  /**
   * Parse what the user typed ("0.1", "-2.5e3") as an EXACT rational N / 10^m.
   * We need this because Number("0.1") already rounds — the whole point
   * is to compare the typed number with what got stored.
   */
  function parseDecimal(str) {
    const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(str);
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return null;
    const negative = m[1] === '-';
    const intDigits = m[2] || '0';
    const fracDigits = m[3] || '';
    let scale = fracDigits.length - Number(m[4] || 0);   // value = N / 10^scale
    let N = BigInt(intDigits + fracDigits);
    if (scale < 0) { N *= 10n ** BigInt(-scale); scale = 0; }
    return { negative, N, scale };
  }

  /**
   * Binary expansion of a typed decimal, computed exactly by repeated
   * doubling (the school method for fraction → binary).
   * Returns the integer part in binary, the first `maxBits` fraction bits,
   * and whether the expansion terminates.
   */
  function binaryExpansion(str, maxBits) {
    const p = parseDecimal(str);
    if (!p) return null;
    const den = 10n ** BigInt(p.scale);
    const intPart = p.N / den;
    let rem = p.N % den;                    // fractional part = rem / den
    let frac = '';
    while (rem !== 0n && frac.length < maxBits) {
      rem *= 2n;                            // shift one binary place left
      if (rem >= den) { frac += '1'; rem -= den; } else { frac += '0'; }
    }
    return {
      negative: p.negative,
      intBits: intPart.toString(2),
      fracBits: frac,
      terminates: rem === 0n,
    };
  }

  /**
   * Where does the real number `str` sit relative to the double `d`?
   * Returns (str − d) measured in ULPs of d (units in the last place).
   * Done in BigInt: (N/10^s − sig·2^e) / 2^e = N·2^−e/10^s − sig.
   */
  function offsetInUlps(str, d) {
    const p = parseDecimal(str);
    if (!p || !Number.isFinite(d) || d === 0) return 0;
    const D = decompose(d);
    const sigSigned = D.sign ? -D.significand : D.significand;
    const N = p.negative ? -p.N : p.N;
    const den = 10n ** BigInt(p.scale);
    // One ULP of d is 2^e (one step of the integer significand).
    // offset = (N/den − sig·2^e) / 2^e, rearranged so we only divide once.
    let num, divisor;
    if (D.exponent < 0) {
      num = N * (1n << BigInt(-D.exponent)) - sigSigned * den;
      divisor = den;
    } else {
      num = N - (sigSigned << BigInt(D.exponent)) * den;
      divisor = den * (1n << BigInt(D.exponent));
    }
    // ×10000 then divide: keeps 4 decimals of the ratio in integer maths.
    return Number((num * 10000n) / divisor) / 10000;
  }

  /**
   * Floating-point addition done by hand, returning every intermediate step.
   * It follows the same idea the CPU follows:
   *   1. decode both numbers into  significand × 2^exponent
   *   2. align: rewrite both with the same (smaller) exponent
   *   3. add the integers — exactly
   *   4. round the exact sum back to 53 significant bits (round half to even)
   *   5. re-encode as a double
   * The test file checks the result is bit-identical to the hardware's a + b.
   */
  function softAdd(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return { special: true, result: a + b, hardware: a + b, matches: true };
    }
    const A = decompose(a);
    const B = decompose(b);

    // Step 1: signed integer significands.
    const sigA = A.sign ? -A.significand : A.significand;
    const sigB = B.sign ? -B.significand : B.significand;

    // Step 2: align to the smaller exponent by shifting the other one LEFT.
    // Shifting left never loses bits, so this is still exact.
    const e = Math.min(A.exponent, B.exponent);
    const shiftA = A.exponent - e;
    const shiftB = B.exponent - e;
    const alignedA = sigA << BigInt(shiftA);
    const alignedB = sigB << BigInt(shiftB);

    // Step 3: exact integer sum. BigInt has no size limit, nothing is lost yet.
    const sum = alignedA + alignedB;

    const steps = { A, B, e, shiftA, shiftB, alignedA, alignedB, sum };

    if (sum === 0n) {
      // IEEE rule: x + (−x) is +0, but (−0) + (−0) is −0.
      const result = A.sign && B.sign ? -0 : 0;
      return finish(steps, { negative: false, mag: 0n, len: 0, cut: 0, kept: 0n,
        dropped: 0n, half: 0n, rounding: 'exact', carry: false, finalExp: e, result }, a, b);
    }

    const negative = sum < 0n;
    const mag = negative ? -sum : sum;
    const len = mag.toString(2).length;     // how many significant bits we have

    // Step 4: keep the top 53 bits, look at what falls off the end.
    let cut = Math.max(len - PRECISION, 0);
    let kept = mag >> BigInt(cut);
    let dropped = 0n, half = 0n, rounding = 'exact', carry = false;
    if (cut > 0) {
      dropped = mag & ((1n << BigInt(cut)) - 1n);   // the bits we throw away
      half = 1n << BigInt(cut - 1);                 // "exactly halfway" = 100…0
      if (dropped > half) {
        kept += 1n; rounding = 'up';
      } else if (dropped === half) {
        // A tie: round to whichever neighbour has a 0 in its last bit (even).
        if ((kept & 1n) === 1n) { kept += 1n; rounding = 'tie, up to even'; }
        else { rounding = 'tie, down to even'; }
      } else {
        rounding = dropped === 0n ? 'exact' : 'down';
      }
      // Rounding up 111…1 gives 1000…0 — one bit too many. Shift it back.
      if (kept === 1n << BigInt(PRECISION)) { kept >>= 1n; cut += 1; carry = true; }
    }
    const finalExp = e + cut;

    // Step 5: rebuild the double. kept < 2^53 converts to Number exactly,
    // and multiplying by a power of two is exact while the result fits.
    let result = finalExp > MAX_EXP ? Infinity : Number(kept) * 2 ** finalExp;
    if (negative) result = -result;

    return finish(steps, { negative, mag, len, cut, kept, dropped, half, rounding,
      carry, finalExp, result }, a, b);
  }

  function finish(steps, r, a, b) {
    const hardware = a + b;
    return Object.assign(steps, r, {
      special: false,
      exactSum: exactDecimal(r.mag, steps.e, r.negative),
      hardware,
      matches: Object.is(r.result, hardware),
    });
  }

  const FloatLab = {
    PRECISION, BIAS, MIN_EXP,
    toBits, fromBits, bitString, decompose,
    exactDecimal, exactValue, nextAway, nextToward,
    parseDecimal, binaryExpansion, offsetInUlps, softAdd,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = FloatLab;
  global.FloatLab = FloatLab;
})(typeof window !== 'undefined' ? window : globalThis);
