# Under the hood

The 3-minute version of how the playground works and what it shows.

## 1. A double is an integer times a power of two

The 64 bits split into three fields:

```
[ sign: 1 bit ][ exponent: 11 bits ][ fraction: 52 bits ]
```

For a normal number:

```
value = (−1)^sign × 1.fraction × 2^(exponent − 1023)
```

- **Sign**: 0 for positive, 1 for negative.
- **Exponent**: stored with a *bias* of 1023, so it can be negative without a sign bit. A stored 1019 means 2^−4.
- **Fraction**: the bits after the binary point. The leading `1.` is **not stored**; it's always there for normal numbers (the "hidden bit"). That gives 52 + 1 = **53 bits of precision**.

In code (`decompose()` in `js/float.js`) the formula is rewritten as one integer times a power of two, which is easier to compute with:

```
value = (−1)^sign × significand × 2^exponent
significand = 2^52 + fraction        (a 53-bit integer)
exponent    = exponentField − 1023 − 52
```

**How we get the bits.** A `DataView` over an 8-byte `ArrayBuffer`: write the float with `setFloat64`, read the same bytes back with `getBigUint64`. Then shifts and masks pull out the fields.

## 2. Why 0.1 can't be stored

Fraction → binary uses repeated doubling: double it, the integer part is the next bit.

```
0.1 → 0.2 → 0.4 → 0.8 → 1.6 → 1.2 → 0.4 → 0.8 → 1.6 → 1.2 → …
       0     0     0     1     1     0     0     1     1
```

The pattern repeats forever: `0.000110011001100110011…`.

- A fraction terminates in base 2 only if its denominator is a power of 2.
- `1/10 = 1/(2·5)`, and the 5 can never go away.
- That's the same reason `1/3` never ends in base 10.

So the infinite pattern is cut after 53 significant bits and **rounded to the nearest** representable value:

| typed | stored exactly | error |
|---|---|---|
| 0.1 | 0.1000000000000000055511151231257827… | slightly **above** |
| 0.2 | 0.2000000000000000111022302462515654… | slightly **above** |
| 0.3 | 0.2999999999999999888977697537484345… | slightly **below** |

That table explains the whole bug: two numbers that are each a bit too big are added, and compared with a number that is a bit too small.

**Showing exact values.** `exactDecimal()` prints them using `1/2^k = 5^k/10^k`. Multiply the significand by `5^k` (BigInt) and put the decimal point k places from the right. Every double has a *finite* exact decimal expansion. That's also why JS normally prints the *shortest* string that rounds back to the same double instead.

## 3. The addition, by hand (`softAdd()`)

`0.1 + 0.2`, with the real numbers from the tool:

1. **Decode**
   - `0.1 = 7205759403792794 × 2^−56`
   - `0.2 = 7205759403792794 × 2^−55` (same significand, exponent one higher, because 0.2 = 2 × 0.1)
2. **Align.** Use the smaller exponent, 2^−56, for both, so 0.2's significand is shifted left by 1. Shifting *left* only appends zeros, so nothing is lost.
3. **Add exactly.** `7205759403792794 + 14411518807585588 = 21617278211378382`. That's **55 bits**, so it doesn't fit in 53.
4. **Round to 53 bits.**
   - The last 2 bits must go. They are `10`, which is *exactly half* a step, so it's a tie.
   - IEEE 754's default rule is **round half to even**: pick the neighbour whose last bit is 0.
   - Here that means rounding **up**.
5. **Re-encode.**
   - The result is `5404319552844596 × 2^−54`.
   - The double for `0.3` is `5404319552844595 × 2^−54`.
   - **They differ by exactly 1 in the last bit (1 ULP).** That one bit is the whole `0.30000000000000004`.

BigInt is used for the exact steps because doing them with floats would hide the very rounding we want to show.

**Why trust the hand version?** `tests/float.test.js` runs `softAdd` on 200 000 random pairs (all exponents, subnormals, mixed signs) plus edge cases. Each result must be *bit-identical* to the CPU's `a + b`, so the step-by-step on screen is what the hardware actually does.

## 4. Doubles are dots on a line

- Between two neighbouring doubles there is nothing. The gap is 1 **ULP** (unit in the last place).
- The gap grows with the number:
  - near 0.3 it is about 5.55e−17
  - above 2⁵³ it is 2, which is why `2**53 + 1 === 2**53`
- Neighbours are found by adding or subtracting 1 to the **bit pattern** (`nextAway`/`nextToward`). For same-sign doubles, the integer order of the bits is the same as the numeric order. The format was designed that way.

## 5. So what do you do?

- **Don't use `===` on computed floats.** Compare with a tolerance.
  - `Number.EPSILON` (2^−52, the gap just above 1) works as an absolute tolerance only near 1.
  - A **relative** tolerance scales: `|x − y| ≤ ε × max(|x|, |y|)`.
- **For money, use integers** (cents). Integers are exact up to 2⁵³.
- **Or use decimal types / BigInt** when exactness matters more than speed.
