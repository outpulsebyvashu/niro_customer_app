/* Niro Admin: Billing. Invoices from Niro to partner businesses for their plan, shown in the three invoice styles (invoice.js).
   Uses the shared kit (api, esc, sheet, toast, money) and the admin app's globals (BILL, bf, CAFES, draw, tab). */
var LIVE = null;
var BILL_STATUS = { unpaid: 'Unpaid', paid: 'Paid', void: 'Void' };

function loadBilling() {
  return api('GET', '/api/admin/billing').then(function (d) { BILL = d; }).catch(function (e) { toast(e.message); });
}
function invStatus(i) { return i.overdue ? 'Overdue' : BILL_STATUS[i.status]; }
function istDay(offsetDays) { var d = new Date(Date.now() + 5.5 * 3600e3 + (offsetDays || 0) * 864e5); return d.toISOString().slice(0, 10); }
function addDays(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function billingBody() {
  if (!BILL) { loadBilling().then(function () { if (tab === 'billing') draw(); }); return '<p class="mut">Loading invoices…</p>'; }
  var S = BILL.summary;
  var list = BILL.invoices.filter(function (i) {
    return bf === 'all' || (bf === 'overdue' ? i.overdue : bf === 'unpaid' ? i.status === 'unpaid' : i.status === bf);
  });
  var h = '<div class="stats">' + [[money(S.outstanding), 'Outstanding'], [money(S.overdue), 'Overdue' + (S.overdue_count ? ' · ' + S.overdue_count : '')], [money(S.collected_month), 'Collected this month'], [S.invoices, 'Invoices']]
    .map(function (s) { return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>'; }).join('') + '</div>';
  h += '<div class="acts"><button id="bnew">New invoice</button><button class="s" id="bset">Billing settings</button></div>';
  h += '<h2>Invoices</h2><div class="tabs">' + [['all', 'All'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']]
    .map(function (t) { return '<button data-bf="' + t[0] + '" aria-current="' + (bf === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>';
  h += '<div class="card">' + (list.length ? list.map(function (i) {
    var st = invStatus(i);
    return '<div class="li bill-li" data-inv="' + esc(i.id) + '" role="button" tabindex="0"><span><b>' + esc(i.bill_to.name) + '</b><span class="pill' + (i.status === 'paid' ? ' on' : '') + (i.overdue ? ' bill-late' : '') + '">' + st + '</span>' +
      '<small>' + esc(i.number) + ' · Issued ' + esc(LH.prettyDay(i.issued_on)) + (i.status === 'unpaid' ? ' · Due ' + esc(LH.prettyDay(i.due_on)) : i.status === 'paid' ? ' · Paid ' + esc(LH.prettyDay(i.paid_on)) : '') + '</small></span>' +
      '<b class="bill-amt' + (i.status === 'void' ? ' bill-void' : '') + '">' + money(i.total) + '</b></div>';
  }).join('') : '<p class="mut" style="margin:0">' + (BILL.invoices.length ? 'No invoices here.' : 'No invoices yet. Make the first one with New invoice.') + '</p>') + '</div>';
  return h;
}

function bindBilling() {
  if (!BILL) return;
  document.querySelectorAll('[data-bf]').forEach(function (b) { b.onclick = function () { bf = b.dataset.bf; draw(); }; });
  var n = $('#bnew'); if (n) n.onclick = function () { invoiceForm(null); };
  var s = $('#bset'); if (s) s.onclick = settingsForm;
  document.querySelectorAll('[data-inv]').forEach(function (r) {
    var open = function () { var i = BILL.invoices.filter(function (x) { return x.id === r.dataset.inv; })[0]; if (i) openInvoice(i); };
    r.onclick = open; r.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
}
function refreshBilling(msg) { return loadBilling().then(function () { if (tab === 'billing' && !$('#scrim')) draw(); if (msg) toast(msg); }); }
function closeInvoice() { if (LIVE) { LIVE.destroy(); LIVE = null; } closeSheet(); if (tab === 'billing') draw(); }

/* ---------- one invoice ---------- */
function waLink(i) {
  var c = (i.bill_to && i.bill_to.contact) || '';
  if (!/^\+91\d{10}$/.test(c)) return '';
  var msg = 'Hi ' + i.bill_to.name + ', here is your Niro invoice ' + i.number + ' for ' + LH.money(i.total, 'paper') +
    (i.status === 'paid' ? ', marked as paid. Thank you!' : ', due on ' + LH.prettyDay(i.due_on) + '. The PDF is attached.');
  return 'https://wa.me/' + c.slice(1) + '?text=' + encodeURIComponent(msg);
}
function openInvoice(i) {
  if (LIVE) { LIVE.destroy(); LIVE = null; }
  var wa = waLink(i), unpaid = i.status === 'unpaid';
  var s = sheet('<div class="bill-top"><span><b>' + esc(i.number) + '</b><span class="pill' + (i.status === 'paid' ? ' on' : '') + (i.overdue ? ' bill-late' : '') + '">' + invStatus(i) + '</span></span><button class="s sm" id="ix">Close</button></div>' +
    '<div id="lhv"></div>' +
    '<div class="acts bill-acts">' +
      (i.status !== 'void' ? '<button id="ipay"' + (unpaid ? '' : ' class="s"') + '>' + (unpaid ? 'Mark as paid' : 'Mark as unpaid') + '</button>' : '') +
      (wa ? '<a class="btn s bill-wa" id="iwa" href="' + esc(wa) + '" target="_blank" rel="noopener">Send on WhatsApp</a>' : '') +
      '<button class="s" id="icp">Copy text</button>' +
      (unpaid ? '<button class="s" id="ied">Edit</button><button class="danger" id="ivd">Void</button>' : '') +
    '</div>' + (wa ? '<p class="mut" style="margin:10px 0 0">WhatsApp opens with a message ready. Download the PDF first and attach it.</p>' : ''));
  s.classList.add('bill-sheet');
  LIVE = LH.mount($('#lhv'), i, {
    mode: i.style,
    onMode: function (m) { i.style = m; api('PATCH', '/api/admin/invoices/' + i.id, { style: m }).catch(function (e) { toast(e.message); }); }
  });
  $('#ix').onclick = closeInvoice;
  $('#scrim').addEventListener('click', function (e) { if (e.target.id === 'scrim' && LIVE) { LIVE.destroy(); LIVE = null; } });
  var pay = $('#ipay');
  if (pay) pay.onclick = function () {
    pay.disabled = true;
    api('PATCH', '/api/admin/invoices/' + i.id, { status: unpaid ? 'paid' : 'unpaid' })
      .then(function (n) { n.style = LIVE ? LIVE.mode : n.style; openInvoice(n); refreshBilling(unpaid ? 'Marked as paid' : 'Marked as unpaid'); })
      .catch(function (e) { pay.disabled = false; toast(e.message); });
  };
  $('#icp').onclick = function () {
    var t = LH.text(i);
    try { navigator.clipboard.writeText(t).then(function () { toast('Invoice text copied'); }, function () { toast('Copy is blocked here. Use Download PDF.'); }); }
    catch (e) { toast('Copy is blocked here. Use Download PDF.'); }
  };
  var ed = $('#ied'); if (ed) ed.onclick = function () { if (LIVE) { LIVE.destroy(); LIVE = null; } invoiceForm(i); };
  var vd = $('#ivd'); if (vd) vd.onclick = function () {
    if (!confirm('Void ' + i.number + '? It stays in the list but no longer counts as owed. This cannot be undone.')) return;
    api('PATCH', '/api/admin/invoices/' + i.id, { status: 'void' }).then(function (n) { openInvoice(n); refreshBilling('Invoice voided'); }).catch(function (e) { toast(e.message); });
  };
}

/* ---------- new / edit invoice ---------- */
function invoiceForm(cur) {
  var S = BILL.settings, editing = !!cur;
  var planItem = cur ? cur.items.filter(function (x) { return x.plan; })[0] : null;
  var plan = cur ? (planItem ? planItem.plan : '') : 'monthly';
  var planQty = planItem ? planItem.qty : 1;
  var extras = cur ? cur.items.filter(function (x) { return !x.plan; }).map(function (x) { return { name: x.name, qty: x.qty, price: x.price }; }) : [];
  var issued = cur ? cur.issued_on : istDay(0), dueTouched = editing;
  var cafeOpts = CAFES.map(function (c) { return '<option value="' + esc(c.id) + '"' + (cur && cur.cafe_id === c.id ? ' selected' : '') + '>' + esc(c.name) + ' · ' + esc([c.area, c.city].filter(Boolean).join(', ')) + '</option>'; }).join('');
  var bt = cur ? cur.bill_to : { name: '', line: '', contact: '', gstin: '' };
  sheet('<h2 style="margin-top:0">' + (editing ? 'Edit ' + esc(cur.number) : 'New invoice') + '</h2><form id="if">' +
    '<label for="ip">Partner</label><select id="ip"' + (editing ? ' disabled' : '') + '><option value="">Someone else</option>' + cafeOpts + '</select>' +
    '<div id="io"><label for="in">Bill to</label><input id="in" maxlength="80" value="' + esc(bt.name) + '" placeholder="Business name">' +
    '<label for="il">Details</label><input id="il" maxlength="120" value="' + esc(bt.line) + '" placeholder="Area, city">' +
    '<label for="ic">Contact</label><input id="ic" maxlength="80" value="' + esc(bt.contact) + '" placeholder="Mobile or email"></div>' +
    '<label for="ig">Partner GSTIN (optional)</label><input id="ig" maxlength="15" value="' + esc(bt.gstin) + '" style="text-transform:uppercase">' +
    '<label>Niro plan</label><div class="tabs" id="ipl">' + [['monthly', 'Monthly · ' + money(S.plans.monthly)], ['yearly', 'Yearly · ' + money(S.plans.yearly)], ['', 'No plan']]
      .map(function (t) { return '<button type="button" data-p="' + t[0] + '" aria-current="' + (plan === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
    '<div id="iqw"><label for="iq" id="iql">Months</label><input id="iq" type="number" min="1" max="24" value="' + planQty + '"></div>' +
    '<label>Other items</label><div id="iit"></div><div class="acts" style="margin-top:6px"><button type="button" class="s sm" id="iadd">Add item</button></div>' +
    '<label for="itx">' + esc(S.tax_name) + ' %</label><input id="itx" type="number" min="0" max="100" step="0.5" value="' + (cur ? cur.tax_rate : S.tax_rate) + '">' +
    '<div class="row"><div><label for="iis">Issued</label><input id="iis" type="date" value="' + issued + '"></div><div><label for="idu">Due</label><input id="idu" type="date" value="' + (cur ? cur.due_on : addDays(issued, S.terms_days)) + '"></div></div>' +
    '<label for="ino">Note</label><textarea id="ino" rows="2" maxlength="300">' + esc(cur ? cur.note : S.note) + '</textarea>' +
    '<div class="card bill-tot" id="itot"></div><p class="err" id="ier" hidden></p>' +
    '<div class="acts"><button class="full" id="igo">' + (editing ? 'Save changes' : 'Create invoice') + '</button><button type="button" class="s full" id="icl">Cancel</button></div></form>');

  function rowsHTML() {
    $('#iit').innerHTML = extras.map(function (x, k) {
      return '<div class="bill-item" data-k="' + k + '"><input data-fld="name" maxlength="80" placeholder="Item or service" value="' + esc(x.name) + '" aria-label="Item ' + (k + 1) + ' name">' +
        '<input data-fld="qty" type="number" min="1" max="999" value="' + x.qty + '" aria-label="Quantity"><input data-fld="price" inputmode="decimal" placeholder="₹" value="' + (x.price || '') + '" aria-label="Price">' +
        '<button type="button" class="s sm" data-rm="' + k + '" aria-label="Remove item">×</button></div>';
    }).join('');
  }
  function items() {
    var out = [];
    if (plan) out.push({ name: plan === 'yearly' ? 'Niro yearly plan' : 'Niro monthly plan', qty: Math.max(1, Math.min(24, parseInt($('#iq').value, 10) || 1)), price: plan === 'yearly' ? S.plans.yearly : S.plans.monthly, plan: plan });
    extras.forEach(function (x) { if (x.name.trim()) out.push({ name: x.name.trim(), qty: x.qty, price: x.price }); });
    return out;
  }
  function totals() {
    var it = items(), rate = parseFloat($('#itx').value) || 0;
    var sub = Math.round(it.reduce(function (a, x) { return a + x.qty * x.price; }, 0) * 100) / 100, tax = Math.round(sub * rate) / 100;
    $('#itot').innerHTML = '<div class="bill-trow"><span>Subtotal</span><b>' + money(sub) + '</b></div><div class="bill-trow"><span>' + esc(S.tax_name) + ' ' + rate + '%</span><b>' + money(tax) + '</b></div><div class="bill-trow bill-grand"><span>Total</span><b>' + money(Math.round((sub + tax) * 100) / 100) + '</b></div>';
  }
  function showOther() { $('#io').hidden = !editing && !!$('#ip').value; }
  function showPlan() {
    document.querySelectorAll('#ipl [data-p]').forEach(function (b) { b.setAttribute('aria-current', String(b.dataset.p === plan)); });
    $('#iqw').hidden = !plan; $('#iql').textContent = plan === 'yearly' ? 'Years' : 'Months'; totals();
  }
  rowsHTML(); showOther(); showPlan();
  $('#ip').onchange = showOther;
  $('#ipl').onclick = function (e) { var b = e.target.closest('[data-p]'); if (b) { plan = b.dataset.p; showPlan(); } };
  $('#iq').oninput = totals; $('#itx').oninput = totals;
  $('#iadd').onclick = function () { extras.push({ name: '', qty: 1, price: 0 }); rowsHTML(); totals(); var r = document.querySelectorAll('.bill-item [data-fld=name]'); r[r.length - 1].focus(); };
  $('#iit').oninput = function (e) {
    var f = e.target.closest('[data-fld]'); if (!f) return;
    var x = extras[+f.closest('.bill-item').dataset.k];
    if (f.dataset.fld === 'name') x.name = f.value; else if (f.dataset.fld === 'qty') x.qty = Math.max(1, Math.min(999, parseInt(f.value, 10) || 1)); else x.price = Math.max(0, parseFloat(f.value.replace(/[^\d.]/g, '')) || 0);
    totals();
  };
  $('#iit').onclick = function (e) { var b = e.target.closest('[data-rm]'); if (b) { extras.splice(+b.dataset.rm, 1); rowsHTML(); totals(); } };
  $('#iis').onchange = function () { if (!dueTouched) $('#idu').value = addDays($('#iis').value, S.terms_days); };
  $('#idu').onchange = function () { dueTouched = true; };
  $('#icl').onclick = function () { closeSheet(); if (cur) openInvoice(cur); };
  $('#if').onsubmit = function (e) {
    e.preventDefault();
    var er = $('#ier'); er.hidden = true;
    var it = items();
    if (!it.length) { er.textContent = 'Pick a plan or add an item.'; er.hidden = false; return; }
    var cafe = editing ? cur.cafe_id : $('#ip').value;
    var who = { name: $('#in').value.trim(), line: $('#il').value.trim(), contact: $('#ic').value.trim(), gstin: $('#ig').value.trim() };
    if (!cafe && !who.name) { er.textContent = 'Choose a partner or enter who the invoice is for.'; er.hidden = false; return; }
    var body = { items: it, tax_rate: parseFloat($('#itx').value) || 0, issued_on: $('#iis').value, due_on: $('#idu').value, note: $('#ino').value.trim() };
    if (editing) body.bill_to = who; else { body.style = 'paper'; if (cafe) { body.cafe_id = cafe; body.bill_to = { gstin: who.gstin }; } else body.bill_to = who; }
    var go = $('#igo'); go.disabled = true;
    api(editing ? 'PATCH' : 'POST', editing ? '/api/admin/invoices/' + cur.id : '/api/admin/invoices', body)
      .then(function (n) { closeSheet(); openInvoice(n); refreshBilling(editing ? 'Saved' : n.number + ' created'); })
      .catch(function (x) { go.disabled = false; er.textContent = x.message; er.hidden = false; });
  };
}

/* ---------- billing settings ---------- */
function settingsForm() {
  var S = BILL.settings, f = S.from;
  sheet('<h2 style="margin-top:0">Billing settings</h2><p class="mut" style="margin:0">New invoices use these. Invoices already made keep what they had.</p><form id="sf">' +
    '<label for="sn">Your business name</label><input id="sn" maxlength="80" value="' + esc(f.name) + '">' +
    '<label for="sl">Tagline</label><input id="sl" maxlength="120" value="' + esc(f.line) + '">' +
    '<label for="sa">Address</label><input id="sa" maxlength="200" value="' + esc(f.address) + '">' +
    '<div class="row"><div><label for="sc">Contact</label><input id="sc" maxlength="80" value="' + esc(f.contact) + '" placeholder="Email or phone"></div><div><label for="sg">GSTIN</label><input id="sg" maxlength="15" value="' + esc(f.gstin) + '" style="text-transform:uppercase"></div></div>' +
    '<div class="row"><div><label for="pm">Monthly plan ₹</label><input id="pm" inputmode="decimal" value="' + S.plans.monthly + '"></div><div><label for="py">Yearly plan ₹</label><input id="py" inputmode="decimal" value="' + S.plans.yearly + '"></div></div>' +
    '<div class="row"><div><label for="tn">Tax name</label><input id="tn" maxlength="20" value="' + esc(S.tax_name) + '"></div><div><label for="tr">Tax %</label><input id="tr" type="number" min="0" max="100" step="0.5" value="' + S.tax_rate + '"></div><div><label for="td">Pay within (days)</label><input id="td" type="number" min="0" max="120" value="' + S.terms_days + '"></div></div>' +
    '<label for="tnote">Note on invoices</label><textarea id="tnote" rows="2" maxlength="300">' + esc(S.note) + '</textarea>' +
    '<p class="err" id="ser" hidden></p><div class="acts"><button class="full">Save</button><button type="button" class="s full" id="scl">Cancel</button></div></form>');
  $('#scl').onclick = closeSheet;
  $('#sf').onsubmit = function (e) {
    e.preventDefault();
    var er = $('#ser'); er.hidden = true;
    var b = { from: { name: $('#sn').value, line: $('#sl').value, address: $('#sa').value, contact: $('#sc').value, gstin: $('#sg').value },
      plans: { monthly: parseFloat($('#pm').value), yearly: parseFloat($('#py').value) }, tax_name: $('#tn').value, tax_rate: parseFloat($('#tr').value), terms_days: parseInt($('#td').value, 10), note: $('#tnote').value };
    api('PUT', '/api/admin/billing/settings', b).then(function () { closeSheet(); refreshBilling('Billing settings saved'); }).catch(function (x) { er.textContent = x.message; er.hidden = false; });
  };
}
