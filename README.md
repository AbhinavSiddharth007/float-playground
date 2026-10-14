# Why `0.1 + 0.2 !== 0.3`

An interactive playground that shows, bit by bit, why floating-point
addition gives "wrong" answers — and that it's actually doing exactly what
the IEEE 754 standard says.

## Run it

- Open `index.html` in any browser (double-click — no server, no build, no libraries).
- Tests: `node tests/float.test.js` — checks the hand-written addition against
  the CPU's own `a + b` on 200 000 random pairs, bit for bit.

## What's on the page

1. **Typed vs stored** — the 64 bits of each number (clickable), the formula,
   the exact decimal value actually stored, and the rounding error in ULPs.
2. **Why it doesn't fit** — the binary expansion of what you typed: the 53
   bits that are kept and the ones cut off. `0.1` in binary never ends.
3. **The addition, step by step** — decode → align → add exactly → round
   to 53 bits (round half to even) → re-encode. Checked against the CPU.
4. **Where it landed** — a zoomed number line of neighbouring doubles.
5. **How to compare** — `===` vs absolute vs relative tolerance vs integers.

## Files

| File | What it does |
|---|---|
| `js/float.js` | The engine: bit decoding, exact decimal values, binary expansion, step-by-step addition. Pure functions, no DOM. |
| `js/app.js` | The page: reads inputs, calls the engine, renders the 5 panels. |
| `css/style.css` | Layout and colours (light/dark). |
| `tests/float.test.js` | Proves the engine matches the hardware. |
| `UNDER_THE_HOOD.md` | The explanation for the "under the hood" part of the demo. |
| `QA_PREP.md` | Likely questions about the code, with answers. |

## Presets worth showing

| Sum | Result | Why it's interesting |
|---|---|---|
| `0.1 + 0.2` | `false` | the classic — a rounding *tie*, broken upward by round-half-to-even |
| `0.5 + 0.25` | `true` | powers of two are exact; no error anywhere |
| `0.1 + 0.7` | `false` | rounds *down* this time: `0.7999999999999999` |
| `2⁵³ + 1` | `true`?! | both sides round to the same wrong number — equal but both wrong |
| `10¹⁶ + 1` | `true`?! | above 2⁵³ the gap between doubles is 2, so `+1` vanishes |
