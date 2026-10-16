
(function () {
  'use strict';
  const F = window.FloatLab;
  const $ = (id) => document.getElementById(id);
  const inputs = { a: $('a'), b: $('b'), c: $('c') };


  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));


  function update() {
    const typed = {}, val = {};
    for (const k of ['a', 'b', 'c']) {
      typed[k] = inputs[k].value.trim();
      val[k] = Number(typed[k]);
      const ok = F.parseDecimal(typed[k]) !== null && Number.isFinite(val[k]);
      inputs[k].classList.toggle('invalid', !ok);
      if (!ok) return;                    
    }
    const r = F.softAdd(val.a, val.b);  

    renderVerdict(typed, val, r.result);
    renderOperands(typed, val, r);
    renderExpansions(typed);
    renderSteps(r);
    renderLine(typed.c, val.c, r.result);
    renderCompare(typed, val, r.result);
  }


  function renderVerdict(typed, val, sum) {
    const eq = sum === val.c;
   
    const shown = String(sum), expected = String(val.c);
    let i = 0;
    while (i < shown.length && shown[i] === expected[i]) i++;
    const printed = eq ? shown : `${shown.slice(0, i)}<span class="wrong">${shown.slice(i)}</span>`;
    $('verdict').innerHTML =
      `<div class="result"><span class="label">a + b evaluates to</span><output>${printed}</output></div>` +
      `<div class="chip ${eq ? 't' : 'f'}">${esc(typed.a)} + ${esc(typed.b)} === ${esc(typed.c)} → ${eq}</div>`;
  }

 
  function canonical(str) {
    const p = F.parseDecimal(str);
    const digits = p.N.toString().padStart(p.scale + 1, '0');
    const int = digits.slice(0, digits.length - p.scale);
    const frac = digits.slice(digits.length - p.scale).replace(/0+$/, '');
    return (p.negative ? '-' : '') + int + (frac ? '.' + frac : '');
  }

 
  function highlightDiff(typedStr, storedStr) {
    let t = canonical(typedStr);
   
    if (storedStr.includes('.') && !t.includes('.')) t += '.';
    t = t.padEnd(storedStr.length, '0');
    if (t === storedStr) return `<span class="same">${storedStr} (exact)</span>`;
    let i = 0;
    while (i < storedStr.length && storedStr[i] === t[i]) i++;   // first differing digit
    return `<span class="same">${storedStr.slice(0, i)}</span><span class="diff">${storedStr.slice(i)}</span>`;
  }

  
  function bitsHtml(x, key) {
    const s = F.bitString(x);
   
    const fields = [[0, 1, 'sign', 'sign'], [1, 12, 'exp', 'exponent · 11'], [12, 64, 'frac', 'fraction · 52']];
    const html = fields.map(([from, to, cls, name]) => {
      let cells = '';
      for (let i = from; i < to; i++) {
        const one = s[i] === '1' ? ' one' : '';
        const data = key ? ` data-key="${key}" data-i="${i}"` : '';
        cells += `<span class="bit${one}"${data} title="bit ${63 - i}">${s[i]}</span>`;
      }
     
      const label = to - from === 1 ? `<b>${name}</b>`
        : `<span>${63 - from}</span><b>${name}</b><span>${64 - to}</span>`;
      return `<div class="field ${cls}" style="flex: ${to - from} 1 0">
        <div class="cells">${cells}</div><div class="flabel">${label}</div></div>`;
    }).join('');
    return `<div class="register-scroll"><div class="register">${html}</div></div>`;
  }

  
  function formula(x) {
    const d = F.decompose(x);
    const frac = d.fraction.toString(2).padStart(52, '0').replace(/0+$/, '') || '0';
    if (d.kind === 'zero') return `${d.sign ? '−' : ''}0  (all exponent and fraction bits are 0)`;
    if (d.kind === 'subnormal') return `(−1)^${d.sign} × 0.${frac} × 2^−1022  (subnormal: no hidden 1)`;
    return `(−1)^${d.sign} × 1.${frac} × 2^(${d.expField} − 1023 = ${d.expField - 1023})`;
  }

  function renderOperands(typed, val, r) {
    const rows = [
      { key: 'a', label: 'a', typed: typed.a, x: val.a },
      { key: 'b', label: 'b', typed: typed.b, x: val.b },
      { key: null, label: 'a + b', typed: null, x: r.result },
      { key: 'c', label: 'c', typed: typed.c, x: val.c },
    ];
    $('operands').innerHTML = rows.map((row) => {
      const stored = F.exactValue(row.x);
      const ulpOff = row.typed ? F.offsetInUlps(row.typed, row.x) : null;
      return `<div class="operand">
        <h3>${row.label}${row.typed ? ` · you typed <code>${esc(row.typed)}</code>` : ' · the computed sum'}
          ${row.typed ? `<span class="tag ${ulpOff === 0 ? 'ok' : 'warn'}">${ulpOff === 0 ? 'stored exactly' : 'rounded'}</span>` : ''}</h3>
        ${bitsHtml(row.x, row.key)}
        <dl class="kv">
          <dt>formula</dt><dd>${formula(row.x)}</dd>
          ${row.typed
            ? `<dt>stored exactly</dt><dd>${highlightDiff(row.typed, stored)}</dd>
               <dt>rounding error</dt><dd>${ulpOff === 0 ? 'none' : `${Math.abs(ulpOff)} ULP ${ulpOff > 0 ? 'below' : 'above'} what you typed`}</dd>`
            : `<dt>exact sum of stored a, b</dt><dd>${r.exactSum}</dd>
               <dt>stored exactly</dt><dd>${stored}</dd>`}
          <dt>JS prints</dt><dd>${row.x}</dd>
        </dl>
      </div>`;
    }).join('');
  }

 
  $('operands').addEventListener('click', (e) => {
    const cell = e.target.closest('.bit[data-key]');
    if (!cell) return;
    const input = inputs[cell.dataset.key];
    const bitIndex = 63n - BigInt(cell.dataset.i);        // cell 0 is bit 63
    const flipped = F.fromBits(F.toBits(Number(input.value)) ^ (1n << bitIndex));
    if (!Number.isFinite(flipped)) return;                 // NaN/Infinity: ignore
    input.value = String(flipped);
    update();
  });

 
  function renderExpansions(typed) {
    $('expansions').innerHTML = ['a', 'b', 'c'].map((k) => {
      const ex = F.binaryExpansion(typed[k], 1200);

      const all = ex.intBits + '.' + ex.fracBits;
      let seen = 0, html = '', leadZeros = 0;
      let started = false;
      for (const ch of all) {
        if (ch === '.') { html += '.'; continue; }
        if (!started && ch === '1') started = true;
        if (!started) {
          leadZeros++;
          if (leadZeros <= 12) html += `<span class="lead">0</span>`;
          else if (leadZeros === 13) html += `<span class="lead">…</span>`;
          continue;
        }
        seen++;
        if (seen > F.PRECISION + 16) break;                // enough to make the point
        html += `<span class="${seen <= F.PRECISION ? 'keep' : 'lost'}">${ch}</span>`;
      }
      const tail = ex.terminates && seen <= F.PRECISION
        ? '<span class="same"> ends — fits exactly</span>'
        : ex.terminates
          ? '<span class="diff"> … ends, but needs more than 53 bits</span>'
          : '<span class="diff"> … never ends</span>';
      return `<div class="expansion"><span class="label">${esc(typed[k])} =</span> ${ex.negative ? '−' : ''}${html}${tail}</div>`;
    }).join('') + `<p class="hint">Blue: the 53 bits that are kept. Red: cut off, then rounded.</p>`;
  }


  const bin = (n) => (n < 0n ? '-' : '') + (n < 0n ? -n : n).toString(2);

 
  function tail(str, width) {
    return str.length <= width ? str.padStart(width) : '…' + str.slice(str.length - width + 1);
  }

  function renderSteps(r) {
    if (r.special) { $('steps').innerHTML = '<li>Infinity/NaN: handled by special rules, not by rounding.</li>'; return; }
    const W = Math.min(110, Math.max(bin(r.alignedA).length, bin(r.alignedB).length, bin(r.sum).length) + 1);

    const sumBits = r.mag.toString(2);
    const keptPart = sumBits.slice(0, sumBits.length - r.cut);
    const dropPart = sumBits.slice(sumBits.length - r.cut);
    const shownKept = tail(keptPart, Math.max(W - dropPart.length, 8));

    $('steps').innerHTML = `
      <li><b>Decode: every double is an integer × a power of two</b>
        <div class="rows">a = <span class="k">${bin(r.A.sign ? -r.A.significand : r.A.significand)}</span> × 2^${r.A.exponent}
b = <span class="k">${bin(r.B.sign ? -r.B.significand : r.B.significand)}</span> × 2^${r.B.exponent}</div></li>

      <li><b>Align: give both the same exponent (2^${r.e})</b>
        Shift the one with the bigger exponent left — appending zeros loses nothing.
        <div class="rows"><span class="m">a « ${r.shiftA}</span>  ${tail(bin(r.alignedA), W)}
<span class="m">b « ${r.shiftB}</span>  ${tail(bin(r.alignedB), W)}</div></li>

      <li><b>Add the integers — still exact</b>
        <div class="rows"><span class="m">sum  </span>  ${tail(bin(r.sum), W)}   <span class="m">(${r.len} significant bits)</span>
<span class="m">value</span>  ${r.exactSum}</div></li>

      <li><b>Round to 53 bits</b>
        ${r.cut === 0
          ? 'The sum fits in 53 bits, so nothing is cut. <span class="badge ok">exact</span>'
          : `${r.len} bits don't fit in 53, so the last ${r.cut} must go.
        <div class="rows"><span class="m">keep | drop</span>  <span class="k">${shownKept}</span>|<span class="d">${dropPart.length > 60 ? '…' + dropPart.slice(-59) : dropPart}</span>
<span class="m">dropped  </span>  ${r.dropped === r.half ? 'exactly half a step → tie' : r.dropped > r.half ? 'more than half a step' : r.dropped === 0n ? 'zero' : 'less than half a step'}
<span class="m">rule     </span>  round to nearest; on a tie, pick the even neighbour (last bit 0)
<span class="m">decision </span>  <b style="display:inline">${r.rounding}</b>${r.carry ? '  (carry made it 54 bits → shift right once)' : ''}</div>`}</li>

      <li><b>Re-encode</b>
        <div class="rows">${bin(r.negative ? -r.kept : r.kept)} × 2^${r.finalExp}
= ${r.result}</div>
        Same bits as the CPU's own <code>a + b</code>?
        <span class="badge ${r.matches ? 'ok' : 'no'}">${r.matches ? 'yes, identical' : 'NO'}</span></li>`;
  }

 
  function renderLine(cStr, c, sum) {
    const box = $('line');
    if (c === 0 || sum === 0 || Math.sign(c) !== Math.sign(sum)) {
      box.innerHTML = '<p class="hint">Zoom works for two non-zero numbers of the same sign.</p>';
      return;
    }
   
    let steps = F.toBits(sum) - F.toBits(c);
    if (c < 0) steps = -steps;
    if (steps > 6n || steps < -6n) {
      box.innerHTML = `<p class="hint">a + b is ${steps} doubles away from c — too far to zoom in on.</p>`;
      return;
    }
    const s = Number(steps);
    const lo = Math.min(0, s) - 2, hi = Math.max(0, s) + 2;
    const n = hi - lo;
    const Wd = 900, H = 150, pad = 50;
    const xOf = (k) => pad + ((k - lo) / n) * (Wd - 2 * pad);
    const dotAt = (k) => (c > 0 ? F.fromBits(F.toBits(c) + BigInt(k)) : F.fromBits(F.toBits(c) - BigInt(k)));

    let svg = `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="number line of nearby doubles">`;
    svg += `<line x1="${pad - 20}" y1="70" x2="${Wd - pad + 20}" y2="70" stroke="var(--line)" stroke-width="2"/>`;
    for (let k = lo; k <= hi; k++) {
      const isC = k === 0, isSum = k === s;
      const col = isSum ? 'var(--bad)' : isC ? 'var(--frac)' : 'var(--muted)';
      svg += `<circle cx="${xOf(k)}" cy="70" r="${isC || isSum ? 7 : 4}" fill="${col}"/>`;
      if (isC) svg += `<text x="${xOf(k)}" y="100" text-anchor="middle" style="fill:var(--frac)">${esc(cStr)} as stored</text>`;
      if (isSum) svg += `<text x="${xOf(k)}" y="${isC ? 118 : 100}" text-anchor="middle" style="fill:var(--bad)">a + b</text>`;
    }
    // The real number the user typed lives between the dots.
    const off = F.offsetInUlps(cStr, c) * (c > 0 ? 1 : -1);
    const xr = xOf(off);
    svg += `<line x1="${xr}" y1="30" x2="${xr}" y2="62" stroke="var(--good)" stroke-width="2"/>`;
    svg += `<text x="${xr}" y="22" text-anchor="middle" style="fill:var(--good)">real ${esc(cStr)}</text>`;
    svg += `<text x="${pad - 20}" y="140">← smaller</text><text x="${Wd - pad + 20}" y="140" text-anchor="end">bigger →</text>`;
    svg += '</svg>';

    const ulp = Math.abs(dotAt(1) - dotAt(0));
    box.innerHTML = svg + `<div class="line-notes">
      <div>gap between dots (1 ULP here) = ${ulp}</div>
      <div>${s === 0 ? '<span class="same">a + b landed on the same dot as c → equal</span>'
        : `<span class="diff">a + b is ${Math.abs(s)} dot${Math.abs(s) > 1 ? 's' : ''} away from c → not equal</span>`}</div></div>`;
  }


  function renderCompare(typed, val, sum) {
    const c = val.c;
    
    const decimals = Math.max(...['a', 'b', 'c'].map((k) => F.parseDecimal(typed[k]).scale));
    const scale = 10 ** decimals;
    const rows = [
      ['a + b === c', sum === c, 'exact bit equality — usually the wrong question'],
      ['Math.abs((a + b) - c) < Number.EPSILON', Math.abs(sum - c) < Number.EPSILON, 'absolute tolerance — fine near 1, wrong for big or tiny numbers'],
      ['Math.abs((a + b) - c) <= Number.EPSILON * Math.max(Math.abs(a + b), Math.abs(c))', Math.abs(sum - c) <= Number.EPSILON * Math.max(Math.abs(sum), Math.abs(c)), 'relative tolerance — scales with the size'],
    ];
    if (decimals <= 15) {
      const ints = Math.round(val.a * scale) + Math.round(val.b * scale) === Math.round(c * scale);
      rows.push([`Math.round(a*1e${decimals}) + Math.round(b*1e${decimals}) === Math.round(c*1e${decimals})`, ints,
        'work in integers (e.g. cents) — exact while below 2^53']);
    }
    $('compare').innerHTML = rows.map(([code, res, note]) =>
      `<div class="row"><code>${code}</code><span class="badge ${res ? 'ok' : 'no'}">${res}</span><span class="note">${note}</span></div>`).join('');
  }

 
  for (const k in inputs) inputs[k].addEventListener('input', update);
  $('presets').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    for (const k of ['a', 'b', 'c']) inputs[k].value = btn.dataset[k];
    update();
  });
  update();
})();
