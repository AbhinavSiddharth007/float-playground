
(function (global) {
  'use strict';

  const FRAC_BITS = 52n;                  
  const PRECISION = 53;                   
  const FRAC_MASK = (1n << FRAC_BITS) - 1n;
  const EXP_MASK = 0x7ffn;                // 11 ones
  const BIAS = 1023;
  const MIN_EXP = -1074;                  
  const MAX_EXP = 971;                    

  
  const view = new DataView(new ArrayBuffer(8));

  
  function toBits(x) {
    view.setFloat64(0, x);
    return view.getBigUint64(0);
  }

 
  function fromBits(bits) {
    view.setBigUint64(0, bits);
    return view.getFloat64(0);
  }

 
  function bitString(x) {
    return toBits(x).toString(2).padStart(64, '0');
  }

  
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
      
      kind = fraction === 0n ? 'zero' : 'subnormal';
      significand = fraction;
      exponent = MIN_EXP;
    } else {
     
      kind = 'normal';
      significand = (1n << FRAC_BITS) | fraction;
      exponent = expField - BIAS - 52;
    }
    return { x, bits, sign, expField, fraction, kind, significand, exponent };
  }


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


  function nextAway(x) { return fromBits(toBits(x) + 1n); }
  function nextToward(x) { return x === 0 ? 0 : fromBits(toBits(x) - 1n); }


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

  
  function binaryExpansion(str, maxBits) {
    const p = parseDecimal(str);
    if (!p) return null;
    const den = 10n ** BigInt(p.scale);
    const intPart = p.N / den;
    let rem = p.N % den;                    
    let frac = '';
    while (rem !== 0n && frac.length < maxBits) {
      rem *= 2n;                            
      if (rem >= den) { frac += '1'; rem -= den; } else { frac += '0'; }
    }
    return {
      negative: p.negative,
      intBits: intPart.toString(2),
      fracBits: frac,
      terminates: rem === 0n,
    };
  }

  
  function offsetInUlps(str, d) {
    const p = parseDecimal(str);
    if (!p || !Number.isFinite(d) || d === 0) return 0;
    const D = decompose(d);
    const sigSigned = D.sign ? -D.significand : D.significand;
    const N = p.negative ? -p.N : p.N;
    const den = 10n ** BigInt(p.scale);

    let num, divisor;
    if (D.exponent < 0) {
      num = N * (1n << BigInt(-D.exponent)) - sigSigned * den;
      divisor = den;
    } else {
      num = N - (sigSigned << BigInt(D.exponent)) * den;
      divisor = den * (1n << BigInt(D.exponent));
    }

    return Number((num * 10000n) / divisor) / 10000;
  }

  
  function softAdd(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return { special: true, result: a + b, hardware: a + b, matches: true };
    }
    const A = decompose(a);
    const B = decompose(b);


    const sigA = A.sign ? -A.significand : A.significand;
    const sigB = B.sign ? -B.significand : B.significand;


    const e = Math.min(A.exponent, B.exponent);
    const shiftA = A.exponent - e;
    const shiftB = B.exponent - e;
    const alignedA = sigA << BigInt(shiftA);
    const alignedB = sigB << BigInt(shiftB);


    const sum = alignedA + alignedB;

    const steps = { A, B, e, shiftA, shiftB, alignedA, alignedB, sum };

    if (sum === 0n) {

      const result = A.sign && B.sign ? -0 : 0;
      return finish(steps, { negative: false, mag: 0n, len: 0, cut: 0, kept: 0n,
        dropped: 0n, half: 0n, rounding: 'exact', carry: false, finalExp: e, result }, a, b);
    }

    const negative = sum < 0n;
    const mag = negative ? -sum : sum;
    const len = mag.toString(2).length;     


    let cut = Math.max(len - PRECISION, 0);
    let kept = mag >> BigInt(cut);
    let dropped = 0n, half = 0n, rounding = 'exact', carry = false;
    if (cut > 0) {
      dropped = mag & ((1n << BigInt(cut)) - 1n);  
      half = 1n << BigInt(cut - 1);                 
      if (dropped > half) {
        kept += 1n; rounding = 'up';
      } else if (dropped === half) {

        if ((kept & 1n) === 1n) { kept += 1n; rounding = 'tie, up to even'; }
        else { rounding = 'tie, down to even'; }
      } else {
        rounding = dropped === 0n ? 'exact' : 'down';
      }
      // Rounding up 111…1 gives 1000…0 — one bit too many. Shift it back.
      if (kept === 1n << BigInt(PRECISION)) { kept >>= 1n; cut += 1; carry = true; }
    }
    const finalExp = e + cut;


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
