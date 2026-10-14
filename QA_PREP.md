# Q&A prep — questions the code invites

Short answers. Line references are to `js/float.js` unless stated.

## The concept

**Is this a JavaScript bug?**
No. JS numbers are IEEE 754 binary64 doubles, and Python, Java, C and C++ give the same `0.30000000000000004`. It's the format, not the language.

**Why does JS print `0.1` if it doesn't store 0.1?**
`Number.prototype.toString` prints the *shortest* decimal that rounds back to the same double. `0.1` is shorter than `0.1000000000000000055…` and maps to the same bits, so that's what you see.

**Which decimals ARE exact?**
Fractions whose denominator is a power of 2: 0.5, 0.25, 0.375, 0.75. Also every integer up to 2⁵³.

**Why round half to even, not half up?**
Half-up always pushes ties the same way, so errors pile up in one direction over many operations. Half-to-even sends ties up half the time and down half the time, so there's no bias. It's IEEE 754's default rounding mode.

- `0.1 + 0.2` is a tie that goes **up**.
- `0.3 + 0.6` is a tie that goes **down**, giving `0.8999999999999999`.

**What's `Number.EPSILON`?**
2⁻⁵², the gap between 1 and the next double. It's only a sensible tolerance near 1. For big numbers the gaps are bigger, which is why the page also shows a relative tolerance.

**What's a ULP?**
Unit in the last place: the gap between a double and its neighbour. It's 2^exponent in our integer form, so it doubles every time the number crosses a power of 2.

**What about float32?**
- 1 sign bit, 8 exponent bits, 23 fraction bits, so 24 bits of precision.
- Same idea, bigger errors: `Math.fround(0.1)` is about `0.100000001`.

## `float.js` line by line

**Why `DataView` and not just `Float64Array`?**
- `DataView` lets us choose byte order. Its default is big-endian, so `getBigUint64` returns the bits in the natural order: sign first.
- A `Float64Array` + `BigUint64Array` sharing a buffer would also work, but it uses the machine's byte order.

**Why one shared `view` at module level?**
No allocation per call. It's safe because JS is single-threaded and each function writes before it reads.

**Why `BigInt` everywhere?**
- The bits are 64 wide, and normal JS numbers are exact only up to 2⁵³.
- Aligned sums can be thousands of bits wide (e.g. `1e300 + 1e-300`).
- Doing the explanation with floats would round, and that would hide the thing we want to show.

**`(bits >> FRAC_BITS) & EXP_MASK`: what does it do?**
It shifts the fraction off the right end, then masks 11 bits (`0x7ff`). That gives the exponent field. The `& EXP_MASK` drops the sign bit that would otherwise remain on top.

**What if you remove `(1n << FRAC_BITS) |` in `decompose`?**
The hidden leading 1 disappears. Every normal number would decode to the wrong value: 0.1 would become roughly 0.025.

**Why `exponent = expField − BIAS − 52`?**
- `− 1023` removes the bias.
- `− 52` is there because we treat the significand as a 53-bit **integer** instead of `1.xxx`. Moving the binary point 52 places right means multiplying by 2⁵², so the exponent compensates.

**Why is the subnormal exponent fixed at −1074?**
- Subnormals use exponent `1 − 1023` (not `0 − 1023`) and have no hidden 1.
- So their value is `fraction × 2^(1 − 1023 − 52)`, which is `fraction × 2^−1074`.

**`exactDecimal`: why `padStart(k + 1, '0')`?**
It guarantees at least one digit before the decimal point. Example: 0.5 is `1 × 2⁻¹`. Then `1 × 5¹ = "5"`, which pads to `"05"` and becomes `"0.5"`. Without the pad you'd get `".5"` or a wrong position.

**Why does `exactDecimal` work at all?**
- `1/2^k = 5^k / 10^k`.
- So `sig × 2^−k = (sig × 5^k) / 10^k`: an integer with the decimal point k places from the right.
- Every double therefore has a finite decimal expansion, though it can be up to ~750 digits.

**`parseDecimal`: why not just `Number(str)`?**
`Number("0.1")` already rounds. We need the *typed* value exactly, as `N / 10^scale` with BigInt, to compare against what was stored.

**`binaryExpansion`: what's the loop?**
- School method: multiply the remainder by 2.
- If it reaches the denominator, the next bit is 1 and you subtract; otherwise the bit is 0.
- It stops when the remainder is 0 (the expansion terminates) or after `maxBits`.

**`softAdd`: why align to the SMALLER exponent?**
Then the other number is shifted **left**, which appends zeros and loses nothing. Shifting right would drop bits before we've even added.

**Why `sum === 0n` as a special case?**
- Signed zero. IEEE says `x + (−x)` is `+0`, but `(−0) + (−0)` is `−0`.
- Also, a zero sum has no bits to round.

**`cut = Math.max(len − PRECISION, 0)`: why the max?**
If the sum has ≤ 53 bits it fits and nothing is cut. A negative value would mean shifting left, which is pointless.

**What's `half`?**
`1 << (cut − 1)`: a 1 followed by zeros, exactly half of one unit in the kept part.

- dropped > half → round up
- dropped < half → round down
- dropped == half → tie, so look at the last kept bit

**When does the carry line run (`kept === 1n << 53n`)?**
- Rounding up `111…1` (53 ones) gives `1000…0`, which is 54 bits.
- Shift right once and bump the exponent.
- Example: `1 + 0.9999999999999999`.

**Follow-up trap: "what if you remove it?"**

- Honest answer: the final *number* would still be right, because `Number(2⁵³) × 2^e` is exact too.
- What breaks is the invariant that `kept` is a valid 53-bit significand.
  - The page would show a 54-bit "significand".
  - The `carry` test in `tests/float.test.js` fails.
- Real hardware has to do this step, because it only has 52 fraction bits to store into.

**Is `Number(kept) * 2 ** finalExp` exact?**
Yes.

- `kept < 2⁵³`, so it converts to a Number exactly.
- `2 ** finalExp` is a power of two, exact for exponents −1074…971.
- Multiplying by a power of 2 only changes the exponent, so there's no rounding while the result is in range.

**Why `finalExp > MAX_EXP ? Infinity`?**
The largest finite double is `(2⁵³ − 1) × 2⁹⁷¹`. A bigger exponent overflows, and round-to-nearest overflows to Infinity.

**Why not handle Infinity/NaN by hand?**
They follow special rules (Inf + −Inf = NaN, etc.), not rounding. That isn't the topic, so we pass them to the hardware.

**Why no ES modules (`import`/`export`)?**
Browsers block module scripts on `file://`. To keep "double-click to run", it's an IIFE that sets one global (`FloatLab`) and also `module.exports` for Node tests.

**`fromBits(toBits(x) + 1n)`: why is that the next double?**
For same-sign doubles the bit patterns, read as integers, are in the same order as the values. The exponent sits above the fraction, so carrying out of the fraction bumps the exponent. The format was designed this way.

## `app.js`

**What's `esc()` for?**
Inputs go into `innerHTML`. Without escaping, typing `<img onerror=…>` would run code (XSS). Invalid input is rejected anyway, but escaping is the safe default.

**Why `return` on invalid input in `update`?**
It keeps the last good picture instead of rendering half-broken panels while you type, e.g. `0.` or `-`.

**The bit click handler: why `63n − i`?**
Cell 0 on screen is the sign, which is bit 63 (most significant). Then `^ (1n << bitIndex)` flips that one bit (XOR).

**Why `if (!Number.isFinite(flipped)) return`?**
Flipping the exponent to all ones produces Infinity or NaN, which isn't a number you can type back into the input.

**Event delegation (one listener on `#operands`)?**
The bit cells are re-created on every render. One listener on the parent survives re-renders; per-cell listeners would need re-attaching each time.

**`renderLine`: why only same-sign, non-zero?**
It counts the distance as `toBits(sum) − toBits(c)`. That ordering trick only holds within one sign (negative doubles count *down* as they get more negative).

**`offsetInUlps`: why `× 10000n`?**
BigInt division truncates. Scaling by 10⁴ first keeps 4 decimal places of the ratio, enough to place the "real 0.3" marker on the line.

## Testing

**How do you know the step-by-step is right?**
`tests/float.test.js`:

- 200 000 random pairs: random raw bit patterns (all exponents, subnormals) plus similar-sized numbers (real rounding).
- Every pair of 17 edge cases.
- Each result must be `Object.is`-identical to the CPU's `a + b`. `Object.is` tells `+0` and `−0` apart, unlike `===`.
