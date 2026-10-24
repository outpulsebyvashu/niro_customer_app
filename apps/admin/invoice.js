/* Niro invoice view: one invoice in three styles (Paper, Block, Terminal), with the morph, stagger and rolling-number animations.
   LH.mount(el, inv, {mode, onMode}) shows it; LH.print(inv, mode) opens the print dialog with an A4 page in that style (Save as PDF). */
(function () {
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var EASE = 'cubic-bezier(.76,0,.24,1)';
  var MODES = [['paper', 'Paper'], ['block', 'Block'], ['term', 'Terminal']];
  var ICON = {
    paper: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 1.5h5.5L11 4v8.5H3z"/><path d="M5 6.5h4M5 9h4"/></svg>',
    block: '<svg viewBox="0 0 14 14"><rect x="2" y="1.5" width="10" height="11" rx="1.5" fill="#ff4f17"/><rect x="4" y="9" width="6" height="1.6" fill="#141414"/></svg>',
    term: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="1.5" width="10" height="11" rx="1.5"/><path d="M4.5 5.5h5M4.5 8h3"/></svg>',
    down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10"/></svg>'
  };
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(v, d) { return Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function money(v, mode) { return mode === 'paper' ? '₹ ' + fmt(v, 2) : mode === 'block' ? '₹' + fmt(Math.round(v), 0) : Number(v).toFixed(2); }
  function prettyDay(s) { return s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function shortDay(s) { return s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''; }
  function phoneOut(c) { return /^\+91\d{10}$/.test(c || '') ? '+91 ' + c.slice(3, 8) + ' ' + c.slice(8) : (c || ''); }

  function party(label, p) {
    p = p || {};
    return '<div class="lh-party"><div class="lh-ph">' + label + '</div><span class="lh-pn">' + e(p.name) + '</span>' +
      (p.line ? '<span class="lh-pl">' + e(p.line) + '</span>' : '') + (p.address ? '<span class="lh-pl">' + e(p.address) + '</span>' : '') +
      (p.contact ? '<span class="lh-pm">' + e(phoneOut(p.contact)) + '</span>' : '') + (p.gstin ? '<span class="lh-pm">GSTIN ' + e(p.gstin) + '</span>' : '') + '</div>';
  }
  function sheetHTML(inv, actions) {
    var parts = String(inv.number || '').split('-'), pre = parts.length > 1 ? parts[0] + '-' : '', num = parts.length > 1 ? parts.slice(1).join('-') : inv.number;
    var rows = (inv.items || []).map(function (it, i) {
      return '<div class="lh-row" data-st><span class="lh-name">' + e(it.name) + '</span><span class="lh-qty lh-num">' + it.qty + '</span><span class="lh-price lh-num" data-n="price:' + i + '"></span><span class="lh-amt lh-num" data-n="amt:' + i + '"></span></div>';
    }).join('');
    var st = inv.status === 'paid' ? '<div>Paid<small>' + e(shortDay(inv.paid_on)) + '</small></div>' : inv.status === 'void' ? '<div>Void</div>' : '';
    return '<div class="lh-chrome" data-st><i></i><i></i><i></i><span>~/niro/invoices/' + e(inv.number) + '.txt</span></div>' +
      '<div class="lh-head" data-st><div class="lh-title"><span class="lh-prompt">$</span><span class="lh-typed"><span class="lh-tw">Invoice</span><span class="lh-tnum"><span class="lh-npre">' + e(pre) + '</span><span class="lh-nnum">' + e(num) + '</span></span></span><span class="lh-caret"></span></div>' +
      '<dl class="lh-dates"><div><dt>Issued</dt><dd>' + e(prettyDay(inv.issued_on)) + '</dd></div><div class="lh-due"><dt>Due</dt><dd>' + e(prettyDay(inv.due_on)) + '</dd></div>' +
      (inv.period_start && inv.period_end ? '<div><dt>Period</dt><dd>' + e(shortDay(inv.period_start)) + ' – ' + e(prettyDay(inv.period_end)) + '</dd></div>' : '') + '</dl></div>' +
      '<div class="lh-parties" data-st>' + party('From', inv.from) + party('Bill to', inv.bill_to) + '</div>' +
      '<div class="lh-items"><div class="lh-ihead" data-st><span>Item</span><span>Qty</span><span>Price</span><span>Amount</span></div><div class="lh-rows">' + rows + '</div>' +
      '<div class="lh-sum" data-st><span>Subtotal</span><span class="lh-num" data-n="sub"></span></div>' +
      '<div class="lh-sum" data-st><span>' + e(inv.tax_name || 'GST') + ' ' + Number(inv.tax_rate) + '%</span><span class="lh-num" data-n="tax"></span></div></div>' +
      '<div class="lh-total" data-st><span class="lh-tl">Total</span><span class="lh-tv"><span class="lh-cur">₹</span><span data-n="int"></span><span class="lh-dec" data-n="dec"></span></span></div>' +
      (inv.note ? '<p class="lh-note" data-st>' + e(inv.note) + '</p>' : '') +
      (actions ? '<div class="lh-actions" data-st><button type="button" class="lh-dl" data-state="idle"></button></div>' : '') +
      '<div class="lh-stamp' + (inv.status === 'void' ? ' void' : '') + '" aria-hidden="true"' + (st ? '' : ' hidden') + '>' + st + '</div>';
  }
  function numbers(inv, mode) {
    var o = {}, tot = Number(inv.total), int = Math.floor(tot + 1e-9), cents = Math.round((tot - int) * 100);
    (inv.items || []).forEach(function (it, i) { o['price:' + i] = money(it.price, mode); o['amt:' + i] = money(it.qty * it.price, mode); });
    o.sub = money(inv.subtotal, mode); o.tax = money(inv.tax, mode);
    o.int = mode === 'term' ? String(int) : fmt(int, 0); o.dec = '.' + String(cents).padStart(2, '0');
    return o;
  }

  /* rolling digits (Paper, Block) and scramble (Terminal) */
  function buildRoll(el, text) {
    el.classList.add('lh-roll');
    el.innerHTML = text.split('').map(function (c) {
      return /\d/.test(c) ? '<span class="lh-rc"><span class="lh-rs">' + '0123456789'.split('').map(function (d) { return '<i>' + d + '</i>'; }).join('') + '</span></span>' : '<span class="lh-rx">' + e(c) + '</span>';
    }).join('');
    el._kind = 'roll'; el._shape = text.replace(/\d/g, '0');
  }
  function roll(el, text) {
    var shape = text.replace(/\d/g, '0');
    if (el._kind !== 'roll' || el._shape !== shape) buildRoll(el, text);
    var cols = [].slice.call(el.querySelectorAll('.lh-rs')), digits = text.replace(/\D/g, '');
    cols.forEach(function (s) { s.style.transition = 'none'; s.style.transform = 'translateY(' + (-Math.floor(Math.random() * 10) * 10) + '%)'; });
    void el.offsetHeight;
    cols.forEach(function (s, i) { s.style.transition = ''; s.style.transitionDelay = (260 + i * 55) + 'ms'; s.style.transform = 'translateY(' + (-digits[i] * 10) + '%)'; });
  }
  function scramble(el, text) {
    el.classList.remove('lh-roll'); el._kind = 'text'; el._shape = null; clearInterval(el._t);
    var t0 = performance.now() + 260, dur = 460;
    el._t = setInterval(function () {
      var p = (performance.now() - t0) / dur, out = '';
      for (var i = 0; i < text.length; i++) { var c = text[i]; out += (/\d/.test(c) && (p < 0 || i / text.length >= p)) ? Math.floor(Math.random() * 10) : c; }
      el.textContent = out; if (p >= 1) { clearInterval(el._t); el.textContent = text; }
    }, 34);
  }
  function fill(root, inv, mode, animate) {
    var n = numbers(inv, mode);
    [].forEach.call(root.querySelectorAll('[data-n]'), function (el) {
      var t = n[el.getAttribute('data-n')]; if (t == null) return;
      el.setAttribute('aria-label', t);
      if (!animate || reduced) { clearInterval(el._t); el.classList.remove('lh-roll'); el._kind = 'text'; el.textContent = t; return; }
      if (mode === 'term') scramble(el, t); else roll(el, t);
    });
  }

  /* ---------- the live view ---------- */
  function mount(host, inv, opts) {
    opts = opts || {};
    var mode = opts.mode || inv.style || 'paper', busy = false, dlState = 'idle';
    host.innerHTML = '<div class="lh"><div class="lh-stage" data-mode="' + mode + '"><div class="lh-surface"></div>' +
      '<div class="lh-switch" role="tablist" aria-label="Invoice style"><span class="lh-ind"></span>' +
      MODES.map(function (m) { return '<button type="button" role="tab" data-lhm="' + m[0] + '" aria-selected="' + (m[0] === mode) + '">' + ICON[m[0]] + m[1] + '</button>'; }).join('') +
      '</div><article class="lh-sheet"></article><p class="lh-hint">The PDF uses the style you pick</p></div></div>';
    var stage = host.querySelector('.lh-stage'), surface = host.querySelector('.lh-surface'), sheet = host.querySelector('.lh-sheet'), ind = host.querySelector('.lh-ind');
    var tabs = [].slice.call(host.querySelectorAll('.lh-switch button'));

    function render(animate) {
      sheet.innerHTML = sheetHTML(inv, true);
      [].forEach.call(sheet.querySelectorAll('[data-st]'), function (n, i) { n.style.setProperty('--i', Math.min(i, 14)); });
      var stamp = sheet.querySelector('.lh-stamp');
      if (stamp && !stamp.hidden) stamp.classList.add(animate && !reduced ? 'show' : 'still');
      renderBtn(); bindBtn();
      fill(sheet, inv, mode, animate);
    }
    function renderBtn() {
      var b = sheet.querySelector('.lh-dl'); if (!b) return;
      b.dataset.state = dlState;
      var gen = mode === 'term' ? 'preparing' : 'Preparing';
      var idle = mode === 'term' ? 'download --pdf' : 'Download PDF';
      if (mode === 'block') b.innerHTML = dlState === 'idle' ? '<span>Download PDF</span><span class="lh-circ">' + ICON.down + '</span>' : '<span>' + gen + ' <span class="lh-pct">0</span>%</span><span class="lh-circ"><span class="lh-spin"></span></span>';
      else b.innerHTML = dlState === 'idle' ? ICON.down + '<span>' + idle + '</span>' : '<span class="lh-spin"></span><span>' + gen + ' <span class="lh-pct">0</span>%</span>';
    }
    function bindBtn() {
      var b = sheet.querySelector('.lh-dl'); if (!b) return;
      b.onclick = function () {
        if (dlState !== 'idle') return;
        dlState = 'loading'; renderBtn();
        var t0 = performance.now(), dur = reduced ? 1 : 650, pct = b.querySelector('.lh-pct');
        (function tick(now) {
          var p = Math.min(1, (now - t0) / dur), v = Math.round((1 - Math.pow(1 - p, 2.2)) * 100);
          b.style.setProperty('--p', v); if (pct) pct.textContent = v;
          if (p < 1) return requestAnimationFrame(tick);
          dlState = 'idle'; b.style.removeProperty('--p'); renderBtn();
          print(inv, mode);
        })(t0);
      };
    }
    function placeSurface() {
      var sr = stage.getBoundingClientRect(), r = sheet.getBoundingClientRect();
      surface.style.left = (r.left - sr.left - stage.clientLeft) + 'px'; surface.style.top = (r.top - sr.top - stage.clientTop) + 'px';
      surface.style.width = r.width + 'px'; surface.style.height = r.height + 'px';
    }
    function moveInd() { var b = tabs.filter(function (t) { return t.dataset.lhm === mode; })[0]; ind.style.left = b.offsetLeft + 'px'; ind.style.width = b.offsetWidth + 'px'; }
    function snap() { var cs = getComputedStyle(surface); return { left: surface.style.left, top: surface.style.top, width: surface.style.width, height: surface.style.height, backgroundColor: cs.backgroundColor, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow }; }
    function transition(change) {
      busy = true;
      var from = snap(), h0 = stage.offsetHeight;
      sheet.classList.remove('entering'); sheet.classList.add('leaving');
      setTimeout(function () {
        change();
        sheet.classList.remove('leaving');
        placeSurface();
        var to = snap(), h1 = stage.offsetHeight;
        if (!reduced) { surface.animate([from, to], { duration: 680, easing: EASE }); stage.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 680, easing: EASE }); }
        sheet.classList.add('entering');
        setTimeout(function () { sheet.classList.remove('entering'); busy = false; }, reduced ? 0 : 1000);
      }, reduced ? 0 : 180);
    }
    function setMode(m) {
      if (m === mode || busy) return;
      mode = m; tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.lhm === m)); }); moveInd();
      transition(function () { stage.dataset.mode = m; dlState = 'idle'; render(true); });
      if (opts.onMode) opts.onMode(m);
    }
    tabs.forEach(function (t) { t.onclick = function () { setMode(t.dataset.lhm); }; });
    host.querySelector('.lh-switch').onkeydown = function (ev) {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      var i = MODES.map(function (m) { return m[0]; }).indexOf(mode), n = tabs[(i + (ev.key === 'ArrowRight' ? 1 : 2)) % 3]; n.focus(); setMode(n.dataset.lhm);
    };

    render(true); moveInd(); placeSurface();
    sheet.classList.add('entering'); setTimeout(function () { sheet.classList.remove('entering'); }, 1100);
    var ro = new ResizeObserver(function () { placeSurface(); moveInd(); }); ro.observe(sheet); ro.observe(stage);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { placeSurface(); moveInd(); });

    return {
      get mode() { return mode; },
      setMode: setMode,
      update: function (next) { inv = next; transition(function () { render(true); }); },
      destroy: function () { ro.disconnect(); host.innerHTML = ''; }
    };
  }

  /* ---------- PDF: an A4 page in the chosen style, through the browser's print dialog (Save as PDF) ---------- */
  function print(inv, mode) {
    var old = document.getElementById('lh-print'); if (old) old.remove();
    var root = document.createElement('div'); root.id = 'lh-print'; root.className = 'lh';
    root.innerHTML = '<div class="lh-export" data-mode="' + mode + '"><div class="lh-xpage"><article class="lh-sheet">' + sheetHTML(inv, false) + '</article></div></div>';
    var stamp = root.querySelector('.lh-stamp'); if (stamp) stamp.classList.remove('show', 'still');
    fill(root, inv, mode, false);
    document.body.appendChild(root);
    var title = document.title;
    document.title = (inv.number || 'Invoice') + ' ' + ((inv.bill_to && inv.bill_to.name) || '');
    function done() { document.title = title; window.removeEventListener('afterprint', done); setTimeout(function () { root.remove(); }, 500); }
    window.addEventListener('afterprint', done);
    var go = function () { window.print(); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(go, 60); }); else setTimeout(go, 60);
  }

  function text(inv) {
    var L = ['Invoice ' + inv.number, 'Issued ' + prettyDay(inv.issued_on) + ' · Due ' + prettyDay(inv.due_on) + (inv.status === 'paid' ? ' · PAID' : ''), '', 'To: ' + ((inv.bill_to && inv.bill_to.name) || ''), ''];
    (inv.items || []).forEach(function (it) { L.push(it.name + ' — ' + it.qty + ' × ' + money(it.price, 'paper') + ' = ' + money(it.qty * it.price, 'paper')); });
    L.push('', 'Subtotal: ' + money(inv.subtotal, 'paper'), (inv.tax_name || 'GST') + ' ' + Number(inv.tax_rate) + '%: ' + money(inv.tax, 'paper'), 'Total: ' + money(inv.total, 'paper'));
    if (inv.note) L.push('', inv.note);
    return L.join('\n');
  }

  window.LH = { mount: mount, print: print, text: text, money: money, prettyDay: prettyDay };
})();
