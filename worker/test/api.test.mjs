// Runs the API against SQLite (node:sqlite) and an in-memory R2 stand-in. Needs Node 22.7 or newer. No installs required.
// It checks the app's logic. It is not a replacement for trying `npm run dev` (wrangler) once.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url).pathname;
const { default: worker } = await import(root + 'src/index.ts');

// ---- tiny D1 and R2 stand-ins ----
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('pragma foreign_keys = on');
if (!process.env.EMPTY_DB) sqlite.exec(readFileSync(root + 'migrations/0001_init.sql', 'utf8')); // EMPTY_DB=1 tests the automatic first-use setup
if (!process.env.EMPTY_DB) sqlite.exec(readFileSync(root + 'seed.sql', 'utf8'));
const norm = (r) => (r === undefined ? null : { ...r });
const stmt = (sql, args = []) => ({
  sql, args,
  bind: (...a) => stmt(sql, a),
  first: async () => norm(sqlite.prepare(sql).get(...args)),
  all: async () => ({ results: sqlite.prepare(sql).all(...args).map(norm), meta: {} }),
  run: async () => { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) }, success: true }; },
});
const DB = { prepare: (s) => stmt(s), batch: async (list) => { sqlite.exec('begin'); try { const out = []; for (const s of list) out.push(await s.run()); sqlite.exec('commit'); return out; } catch (e) { sqlite.exec('rollback'); throw e; } } };
const store = new Map();
const MEDIA = {
  put: async (k, v, o) => store.set(k, { v, type: o?.httpMetadata?.contentType }),
  get: async (k) => { const o = store.get(k); return o ? { body: o.v, httpMetadata: { contentType: o.type }, httpEtag: '"x"' } : null; },
  delete: async (k) => store.delete(k),
};
const env = { DB, MEDIA, ASSETS: { fetch: async () => new Response('<html>app</html>') }, DEV_OTP: '1' };

let t = 0;
const call = async (method, path, { token, body, raw, type } = {}) => {
  // each call gets a fresh clock so the 30s resend limit does not get in the way of tests
  const headers = { ...(token ? { authorization: 'Bearer ' + token } : {}) };
  let b;
  if (raw) { b = raw; headers['content-type'] = type; } else if (body !== undefined) { b = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const res = await worker.fetch(new Request('http://localhost' + path, { method, headers, body: b }), env);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
};
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
const login = async (phone, name) => {
  sqlite.exec('delete from otp_requests');
  ok(await call('POST', '/api/auth/request-otp', { body: { phone, name } }));
  return ok(await call('POST', '/api/auth/verify', { body: { phone, code: '123456' } })).token;
};
const step = (n) => console.log('ok -', n);

// ---- static files pass through ----
assert.equal((await call('GET', '/')).status, 200); step('static files served by assets');

// ---- sign in ----
assert.equal((await call('POST', '/api/auth/request-otp', { body: { phone: '12345' } })).status, 400); step('bad phone rejected');
ok(await call('POST', '/api/auth/request-otp', { body: { phone: '93355 12597', name: 'Vashudev' } }));
assert.equal((await call('POST', '/api/auth/request-otp', { body: { phone: '9335512597' } })).status, 429); step('resend within 30s blocked');
assert.equal((await call('POST', '/api/auth/verify', { body: { phone: '9335512597', code: '000000' } })).status, 400); step('wrong code rejected');
const v = ok(await call('POST', '/api/auth/verify', { body: { phone: '9335512597', code: '123456' } }));
assert.equal(v.user.name, 'Vashudev'); assert.equal(v.user.phone, '+919335512597');
assert.match(v.token, /^[\w-]{40,}$/); step('sign in with OTP, account created');
const me = v.token;
assert.equal((await call('POST', '/api/auth/verify', { body: { phone: '9335512597', code: '123456' } })).status, 400); step('code cannot be reused');
// five wrong tries lock the code
sqlite.exec('delete from otp_requests');
ok(await call('POST', '/api/auth/request-otp', { body: { phone: '9335512597' } }));
for (let i = 0; i < 5; i++) await call('POST', '/api/auth/verify', { body: { phone: '9335512597', code: '111111' } });
assert.equal((await call('POST', '/api/auth/verify', { body: { phone: '9335512597', code: '123456' } })).status, 429); step('locked after 5 wrong tries');
assert.equal((await call('GET', '/api/me')).status, 401); step('no session = 401');

// ---- profile ----
ok(await call('PATCH', '/api/me', { token: me, body: { birthday: '1998-03-12', email: 'v@example.com', diet: 'Vegetarian', fav_order: 'Oat flat white', prefs: { geo: false, treats: true } } }));
assert.equal((await call('PATCH', '/api/me', { token: me, body: { email: 'nope' } })).status, 400);
assert.equal((await call('PATCH', '/api/me', { token: me, body: { birthday: '2999-01-01' } })).status, 400);
assert.equal((await call('PATCH', '/api/me', { token: me, body: { name: '   ' } })).status, 400); step('profile fields validated');
ok(await call('PUT', '/api/me/special-dates', { token: me, body: { dates: [{ label: 'Anniversary', on_date: '2020-11-02' }, { label: '', on_date: '2019-05-09' }] } }));
let prof = ok(await call('GET', '/api/me', { token: me }));
assert.equal(prof.special_dates.length, 2); assert.equal(prof.prefs.geo, false); assert.equal(prof.diet, 'Vegetarian'); step('special days saved');
assert.equal((await call('PUT', '/api/me/special-dates', { token: me, body: { dates: Array(6).fill({ label: 'x', on_date: '2020-01-01' }) } })).status, 400); step('max 5 special days');

// ---- photo in R2 ----
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
const up = ok(await call('PUT', '/api/me/photo', { token: me, raw: png, type: 'image/png' }));
assert.match(up.photo_url, /^\/api\/media\/avatars\//);
assert.equal((await call('PUT', '/api/me/photo', { token: me, raw: png, type: 'text/html' })).status, 415);
assert.equal((await call('PUT', '/api/me/photo', { token: me, raw: new Uint8Array(3 * 1024 * 1024), type: 'image/png' })).status, 413);
assert.equal((await call('GET', up.photo_url, { token: me })).status, 200);
const other = await login('9876543210', 'Other');
assert.equal((await call('GET', up.photo_url, { token: other })).status, 403);
assert.equal((await call('GET', up.photo_url)).status, 401); step('photo stored in R2, private to its owner');
const up2 = ok(await call('PUT', '/api/me/photo', { token: me, raw: png, type: 'image/png' }));
assert.equal([...store.keys()].filter((k) => k.startsWith('avatars/')).length, 1); step('old photo removed on replace');

// ---- browse and join ----
const near = ok(await call('GET', '/api/cafes/nearby?lat=12.3124&lng=76.6277&limit=3'));
assert.equal(near.cafes[0].id, 'agr'); assert.ok(near.cafes[0].distance_m < 5); assert.equal(near.cafes.length, 3);
assert.equal(near.cafes[0].brand.pattern, 'rings'); step('nearby cafes sorted by distance');
assert.equal((await call('GET', '/api/cafes/nearby?lat=abc&lng=1')).status, 400);
assert.ok(ok(await call('GET', '/api/offers')).offers.length >= 5); step('offers listed');
assert.equal((await call('POST', '/api/cafes/agr/join', { body: {} })).status, 401);
const card = ok(await call('POST', '/api/cafes/agr/join', { token: me, body: { offers: true } }), 201);
assert.match(card.member_code, /^[A-Z2-9]{10}$/); assert.equal(card.stamps, 0);
const again = ok(await call('POST', '/api/cafes/agr/join', { token: me, body: { offers: false } }), 201);
assert.equal(again.member_code, card.member_code); assert.equal(again.offers_opt_in, 0); step('join is idempotent and keeps the same code');
assert.equal((await call('POST', '/api/cafes/nope/join', { token: me, body: {} })).status, 404);
ok(await call('POST', '/api/cafes/kaa/join', { token: me, body: {} }), 201);
const cards = ok(await call('GET', '/api/memberships', { token: me })).cards;
assert.equal(cards.length, 2); assert.equal(cards[0].cafe.name, 'Agrahara Roasters'); assert.equal(cards[0].cafe.id, 'agr'); step('wallet cards listed');
assert.equal((await call('GET', '/api/memberships', { token: other })).data.cards.length, 0); step('other users see none of my cards');
ok(await call('PATCH', '/api/memberships/' + card.id, { token: me, body: { offers: true } }));
assert.equal((await call('PATCH', '/api/memberships/' + card.id, { token: other, body: { offers: true } })).status, 404); step('cannot edit someone else\'s card');

// ---- customers cannot stamp ----
assert.equal((await call('POST', '/api/staff/stamp', { token: me, body: { code: card.member_code } })).status, 404); step('customer cannot add stamps');

// ---- nearby alert cap (2 a day, all cafes) ----
let a = ok(await call('POST', '/api/geo-alerts', { token: other, body: { cafe_id: 'agr' } })); assert.equal(a.allowed, true);
a = ok(await call('POST', '/api/geo-alerts', { token: other, body: { cafe_id: 'kaa' } })); assert.equal(a.allowed, true);
a = ok(await call('POST', '/api/geo-alerts', { token: other, body: { cafe_id: 'cru' } })); assert.equal(a.allowed, false); assert.equal(a.reason, 'daily_limit');
a = ok(await call('POST', '/api/geo-alerts', { token: me, body: { cafe_id: 'agr' } })); assert.equal(a.allowed, false); assert.equal(a.reason, 'off'); step('2 alerts a day, and off switch respected');
// yesterday's alerts do not count
sqlite.exec(`update geo_alerts set sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')`);
a = ok(await call('POST', '/api/geo-alerts', { token: other, body: { cafe_id: 'cru' } })); assert.equal(a.allowed, true); step('cap resets the next day');
ok(await call('POST', '/api/devices', { token: me, body: { token: 'fcm-token-1', platform: 'android' } }));
assert.equal((await call('POST', '/api/devices', { token: me, body: { token: 't', platform: 'tv' } })).status, 400); step('device token saved');

// ---- cafe owner and staff ----
const owner = await login('9000000001', 'Asha');
const created = ok(await call('POST', '/api/cafes', { token: owner, body: { name: 'Test Cafe', lat: 12.3, lng: 76.6, area: 'Gokulam', brand: { bg: '#112233', ink: '#ffffff', acc: '#ff8800', pattern: 'grid' }, stamp_goal: 3 } }), 201);
const cid = created.id;
assert.equal(created.pending_approval, true);
assert.equal(ok(await call('GET', '/api/cafes/nearby?lat=12.3&lng=76.6')).cafes.some((c) => c.id === cid), false); step('new cafe is hidden until approved');
sqlite.exec(`update cafes set is_active = 1 where id = '${cid}'`);
assert.equal((await call('POST', '/api/cafes', { token: owner, body: { name: 'Bad', lat: 1, lng: 1, brand: { bg: 'red', ink: '#fff', acc: '#fff' } } })).status, 400); step('brand colours validated');
ok(await call('PATCH', '/api/cafes/' + cid, { token: owner, body: { reward_text: 'Free cake', brand: { bg: '#000000', ink: '#ffffff', acc: '#00ff00', pattern: 'stripes' } } }));
assert.equal((await call('PATCH', '/api/cafes/' + cid, { token: me, body: { name: 'Hacked' } })).status, 403); step('only the owner edits the cafe');
const ph = ok(await call('POST', '/api/cafes/' + cid + '/photos', { token: owner, raw: png, type: 'image/png' }), 201);
assert.equal((await call('GET', ph.url)).status, 200); step('cafe photo public from R2');
assert.equal((await call('POST', '/api/cafes/' + cid + '/photos', { token: me, raw: png, type: 'image/png' })).status, 403);
ok(await call('POST', '/api/cafes/' + cid + '/offers', { token: owner, body: { title: 'Free cookie' } }), 201);
ok(await call('POST', '/api/cafes/' + cid + '/staff', { token: owner, body: { phone: '9000000002', role: 'staff', hourly_rate: 150 } }), 201);
const barista = await login('9000000002', 'Ravi');
assert.equal(ok(await call('GET', '/api/staff/me', { token: barista })).jobs[0].cafe_id, cid); step('staff added by phone number sees their job');

const mine = ok(await call('POST', '/api/cafes/' + cid + '/join', { token: me, body: {} }), 201);
let s = ok(await call('POST', '/api/staff/stamp', { token: barista, body: { code: mine.member_code.toLowerCase(), qty: 2 } }));
assert.equal(s.stamps, 2); assert.equal(s.reward_ready, false);
s = ok(await call('POST', '/api/staff/stamp', { token: barista, body: { code: mine.member_code, qty: 5 } }));
assert.equal(s.stamps, 3); assert.equal(s.reward_ready, true); step('stamps add up, capped at the goal');
assert.equal((await call('POST', '/api/staff/stamp', { token: owner, body: { code: card.member_code } })).status, 404); step('staff cannot stamp another cafe\'s cards');
assert.equal((await call('POST', '/api/staff/redeem', { token: barista, body: { code: card.member_code } })).status, 404);
s = ok(await call('POST', '/api/staff/redeem', { token: barista, body: { code: mine.member_code } }));
assert.equal(s.stamps, 0); assert.equal(s.rewards_redeemed, 1);
assert.equal((await call('POST', '/api/staff/redeem', { token: barista, body: { code: mine.member_code } })).status, 409); step('reward redeemed once, not twice');
assert.equal((await call('POST', '/api/staff/stamp', { token: barista, body: { code: 'ZZZZZZZZZZ' } })).status, 404);

// ---- shifts and payroll ----
ok(await call('POST', '/api/staff/clock-in', { token: barista, body: { cafe_id: cid } }), 201);
assert.equal((await call('POST', '/api/staff/clock-in', { token: barista, body: { cafe_id: cid } })).status, 409);
sqlite.exec(`update shifts set clock_in = strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 hours')`);
ok(await call('POST', '/api/staff/clock-out', { token: barista, body: { cafe_id: cid } }));
assert.equal((await call('POST', '/api/staff/clock-out', { token: barista, body: { cafe_id: cid } })).status, 409); step('clock in and out');
const today = new Date().toISOString().slice(0, 10);
const pay = ok(await call('GET', `/api/cafes/${cid}/payroll?from=${today}&to=${today}`, { token: owner }));
const row = pay.rows.find((r) => r.name === 'Ravi');
assert.ok(Math.abs(row.hours - 4) < 0.05, 'hours ' + row.hours); assert.ok(Math.abs(row.pay - 600) < 10, 'pay ' + row.pay); step('payroll: 4 hours at 150 = 600');
assert.equal((await call('GET', `/api/cafes/${cid}/payroll?from=${today}&to=${today}`, { token: barista })).status, 403); step('staff cannot see payroll');
const st = ok(await call('GET', `/api/cafes/${cid}/stats`, { token: barista }));
assert.equal(st.members, 1); assert.equal(st.stamps_today, 3); assert.equal(st.rewards_redeemed, 1); step('dashboard stats');

// ---- sign out and delete ----
ok(await call('POST', '/api/auth/logout', { token: other }));
assert.equal((await call('GET', '/api/me', { token: other })).status, 401); step('logout ends the session');
ok(await call('DELETE', '/api/me', { token: me }));
assert.equal((await call('GET', '/api/me', { token: me })).status, 401);
assert.equal(sqlite.prepare('select count(*) n from memberships where user_id = (select id from users where phone = ?)').get('+919335512597').n, 0);
assert.equal([...store.keys()].filter((k) => k.startsWith('avatars/')).length, 0); step('delete my account removes cards and photo');
assert.equal((await call('GET', '/api/nothing')).status, 404);
// ---- security checks ----
const raw = (path, init = {}, host = 'https://niro.example') => worker.fetch(new Request(host + path, init), env);
// the fixed test code must not work on a live (non-localhost) site
let r = await raw('/api/auth/request-otp', { method: 'POST', body: JSON.stringify({ phone: '9111111111', name: 'X' }), headers: { 'content-type': 'application/json' } });
assert.equal(r.status, 500); // no SMS provider set up: fails closed instead of using 123456
r = await raw('/api/auth/verify', { method: 'POST', body: JSON.stringify({ phone: '9111111111', code: '123456' }), headers: { 'content-type': 'application/json' } });
assert.equal(r.status, 400); step('test code 123456 ignored on a live site');
// another website cannot make changes for a signed-in user
r = await raw('/api/me', { method: 'PATCH', body: '{"name":"Evil"}', headers: { 'content-type': 'application/json', origin: 'https://evil.example', authorization: 'Bearer ' + owner } });
assert.equal(r.status, 403); step('cross-site writes blocked');
// a fake image is refused
assert.equal((await call('PUT', '/api/me/photo', { token: owner, raw: new TextEncoder().encode('<script>alert(1)</script>'), type: 'image/png' })).status, 415); step('fake image refused');
// manager cannot demote the owner or add managers
ok(await call('POST', '/api/cafes/' + cid + '/staff', { token: owner, body: { phone: '9000000003', role: 'manager' } }), 201);
const mgr = await login('9000000003', 'Meera');
assert.equal((await call('POST', '/api/cafes/' + cid + '/staff', { token: mgr, body: { phone: '9000000001', role: 'staff' } })).status, 201);
assert.equal(sqlite.prepare(`select role from staff where cafe_id = ? and user_id = (select id from users where phone = '+919000000001')`).get(cid).role, 'owner');
assert.equal((await call('POST', '/api/cafes/' + cid + '/staff', { token: mgr, body: { phone: '9000000009', role: 'manager' } })).status, 403); step('owner role protected, only owner adds managers');
// staff cannot stamp their own card
ok(await call('POST', '/api/cafes/' + cid + '/join', { token: barista, body: {} }), 201);
const own = ok(await call('GET', '/api/memberships', { token: barista })).cards[0];
assert.equal((await call('POST', '/api/staff/stamp', { token: barista, body: { code: own.member_code } })).status, 403); step('staff cannot stamp own card');
// parallel code guesses cannot beat the 5-try limit
await call('POST', '/api/auth/request-otp', { body: { phone: '9222222222', name: 'G' } });
const guesses = await Promise.all(Array.from({ length: 20 }, (_, i) => call('POST', '/api/auth/verify', { body: { phone: '9222222222', code: String(100000 + i) } })));
assert.ok(guesses.filter((g) => g.status === 400).length <= 5); step('OTP guess limit holds under parallel tries');

console.log('\nALL PASSED');
