/**
 * Cafe Loyalty API, running on Cloudflare Workers with D1 (database) and R2 (files).
 * The app itself is the Next.js project in the repo root. This Worker is only the API.
 *
 * D1 has no row-level security, so every permission check is in this file:
 *  - customers can read and change only their own data
 *  - stamps change only through /api/staff/stamp and /api/staff/redeem, which check the caller works at that cafe
 *  - owners and managers manage their own cafe only
 */

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS?: Fetcher;       // not used when the app is hosted separately
  DEV_OTP?: string;        // "1" = skip SMS, every code is 123456 (testing only)
  TWILIO_SID?: string;     // secrets: wrangler secret put TWILIO_SID, etc.
  TWILIO_TOKEN?: string;
  TWILIO_FROM?: string;
}

type User = {
  id: string; phone: string; name: string; photo_key: string | null; birthday: string | null;
  email: string | null; diet: string | null; fav_order: string | null; prefs: string;
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const GEO_DAILY_CAP = 2;
const SESSION_DAYS = 30;
const OTP_MINUTES = 5;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PATTERNS = ['dots', 'stripes', 'rings', 'grid'];

// ---------- small helpers ----------
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function memberCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  const a = crypto.getRandomValues(new Uint8Array(10));
  return [...a].map((b) => chars[b % chars.length]).join('');
}

function otpCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
}

function normalizePhone(raw: unknown): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d;
  if (!/^[6-9]\d{9}$/.test(ten)) throw new HttpError(400, 'Enter a valid 10-digit mobile number.');
  return '+91' + ten;
}

async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, 'Send a JSON body.'); }
}

function str(v: unknown, max: number, field: string, required = false): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${field} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text.`);
  const t = v.trim();
  if (required && !t) throw new HttpError(400, `${field} is required.`);
  if (t.length > max) throw new HttpError(400, `${field} is too long.`);
  return t;
}

function validDate(v: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${field} must be YYYY-MM-DD.`);
  if (v > now().slice(0, 10)) throw new HttpError(400, `${field} can't be in the future.`);
  return v;
}

/** Start of today in India time, as a UTC ISO string. */
function istDayStart(): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const start = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600 * 1000;
  return new Date(start).toISOString();
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

// ---------- SMS ----------
async function sendOtp(env: Env, phone: string, code: string): Promise<void> {
  if (env.DEV_OTP === '1') return;
  if (!env.TWILIO_SID || !env.TWILIO_TOKEN || !env.TWILIO_FROM) throw new HttpError(500, 'SMS is not set up yet.');
  // Twilio shown as the example. To use MSG91, Textlocal or another Indian provider, replace this call.
  // India requires DLT registration of the sender ID and message template.
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, From: env.TWILIO_FROM, Body: `${code} is your Cafe Loyalty code. It expires in ${OTP_MINUTES} minutes.` }),
  });
  if (!res.ok) throw new HttpError(502, 'Could not send the SMS. Try again.');
}

// ---------- auth ----------
function tokenFrom(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (h?.startsWith('Bearer ')) return h.slice(7);
  const m = /(?:^|;\s*)cl_session=([^;]+)/.exec(req.headers.get('cookie') ?? '');
  return m ? m[1] : null;
}

async function requireUser(req: Request, env: Env): Promise<User> {
  const token = tokenFrom(req);
  if (!token) throw new HttpError(401, 'Sign in first.');
  const u = await env.DB.prepare(
    `select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ?`
  ).bind(await sha256(token), now()).first<User>();
  if (!u) throw new HttpError(401, 'Your session has expired. Sign in again.');
  return u;
}

async function staffRow(env: Env, userId: string, cafeId: string) {
  return env.DB.prepare(`select id, role, hourly_rate from staff where cafe_id = ? and user_id = ? and is_active = 1`)
    .bind(cafeId, userId).first<{ id: string; role: string; hourly_rate: number }>();
}
async function requireStaff(env: Env, userId: string, cafeId: string) {
  const s = await staffRow(env, userId, cafeId);
  if (!s) throw new HttpError(403, 'You are not staff at this cafe.');
  return s;
}
async function requireManager(env: Env, userId: string, cafeId: string) {
  const s = await requireStaff(env, userId, cafeId);
  if (s.role !== 'owner' && s.role !== 'manager') throw new HttpError(403, 'Only the owner or a manager can do this.');
  return s;
}

// ---------- shaping responses ----------
function publicUser(u: User, dates: { id: string; label: string; on_date: string }[] = []) {
  return {
    id: u.id, phone: u.phone, name: u.name, birthday: u.birthday, email: u.email, diet: u.diet, fav_order: u.fav_order,
    prefs: JSON.parse(u.prefs), photo_url: u.photo_key ? `/api/media/${u.photo_key}` : null, special_dates: dates,
  };
}

type CafeRow = {
  id: string; name: string; slug: string | null; kind: string; area: string | null; city: string; lat: number; lng: number;
  opens: string | null; closes: string | null; brand: string; photo_keys: string; stamp_goal: number; reward_text: string; is_active: number;
};
function publicCafe(c: CafeRow) {
  return {
    id: c.id, name: c.name, slug: c.slug, kind: c.kind, area: c.area, city: c.city, lat: c.lat, lng: c.lng,
    opens: c.opens, closes: c.closes, brand: JSON.parse(c.brand), stamp_goal: c.stamp_goal, reward_text: c.reward_text,
    photos: (JSON.parse(c.photo_keys) as string[]).map((k) => `/api/media/${k}`),
  };
}

async function readImage(req: Request): Promise<{ bytes: ArrayBuffer; ext: string; type: string }> {
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new HttpError(415, 'Send a JPEG, PNG or WebP image.');
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image must be under 2 MB.');
  return { bytes, ext, type };
}

function cleanBrand(b: unknown): string {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'brand must be an object.');
  const o = b as Record<string, unknown>;
  const hex = (v: unknown, f: string) => {
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new HttpError(400, `brand.${f} must be a hex colour like #3b2418.`);
    return v;
  };
  const pattern = String(o.pattern ?? 'dots');
  if (!PATTERNS.includes(pattern)) throw new HttpError(400, `brand.pattern must be one of ${PATTERNS.join(', ')}.`);
  return JSON.stringify({ bg: hex(o.bg, 'bg'), ink: hex(o.ink, 'ink'), acc: hex(o.acc, 'acc'), pattern });
}

// ---------- routes ----------
type Ctx = { req: Request; env: Env; url: URL; p: Record<string, string> };
type Handler = (c: Ctx) => Promise<Response>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)').replace(/\*(\w+)/, '(?<$1>.+)') + '$'), h]);

// --- sign in ---
route('POST', '/api/auth/request-otp', async ({ req, env }) => {
  const b = await body(req);
  const phone = normalizePhone(b.phone);
  const name = str(b.name, 60, 'Name');
  const recent = await env.DB.prepare(`select created_at from otp_requests where phone = ? and created_at > ? order by created_at desc`)
    .bind(phone, new Date(Date.now() - 3600_000).toISOString()).all<{ created_at: string }>();
  if (recent.results.length >= 5) throw new HttpError(429, 'Too many codes requested. Try again in an hour.');
  if (recent.results[0] && Date.now() - Date.parse(recent.results[0].created_at) < 30_000) throw new HttpError(429, 'Wait 30 seconds before asking for another code.');

  const code = env.DEV_OTP === '1' ? '123456' : otpCode();
  await env.DB.batch([
    env.DB.prepare(`insert into otp_codes (phone, code_hash, name, attempts, expires_at) values (?, ?, ?, 0, ?)
                    on conflict(phone) do update set code_hash = excluded.code_hash, name = excluded.name, attempts = 0, expires_at = excluded.expires_at`)
      .bind(phone, await sha256(phone + ':' + code), name, new Date(Date.now() + OTP_MINUTES * 60_000).toISOString()),
    env.DB.prepare(`insert into otp_requests (phone, created_at) values (?, ?)`).bind(phone, now()),
  ]);
  await sendOtp(env, phone, code);
  return json({ ok: true, expires_in: OTP_MINUTES * 60, dev: env.DEV_OTP === '1' ? 'Testing mode: the code is 123456' : undefined });
});

route('POST', '/api/auth/verify', async ({ req, env, url }) => {
  const b = await body(req);
  const phone = normalizePhone(b.phone);
  const code = String(b.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the 6-digit code.');
  const row = await env.DB.prepare(`select code_hash, name, attempts, expires_at from otp_codes where phone = ?`)
    .bind(phone).first<{ code_hash: string; name: string | null; attempts: number; expires_at: string }>();
  if (!row || row.expires_at < now()) throw new HttpError(400, 'That code has expired. Ask for a new one.');
  if (row.attempts >= 5) throw new HttpError(429, 'Too many wrong tries. Ask for a new code.');
  if ((await sha256(phone + ':' + code)) !== row.code_hash) {
    await env.DB.prepare(`update otp_codes set attempts = attempts + 1 where phone = ?`).bind(phone).run();
    throw new HttpError(400, 'That code is not right.');
  }
  await env.DB.prepare(`delete from otp_codes where phone = ?`).bind(phone).run();

  await env.DB.prepare(`insert into users (id, phone, name) values (?, ?, ?) on conflict(phone) do nothing`).bind(uuid(), phone, row.name ?? '').run();
  if (row.name) await env.DB.prepare(`update users set name = ? where phone = ? and name = ''`).bind(row.name, phone).run();
  const user = await env.DB.prepare(`select * from users where phone = ?`).bind(phone).first<User>();
  if (!user) throw new HttpError(500, 'Could not create your account.');

  const token = randomToken();
  await env.DB.prepare(`insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)`)
    .bind(await sha256(token), user.id, new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()).run();
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return json({ token, user: publicUser(user) }, 200, {
    'set-cookie': `cl_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`,
  });
});

route('POST', '/api/auth/logout', async ({ req, env }) => {
  const t = tokenFrom(req);
  if (t) await env.DB.prepare(`delete from sessions where token_hash = ?`).bind(await sha256(t)).run();
  return json({ ok: true }, 200, { 'set-cookie': 'cl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
});

// --- my profile ---
route('GET', '/api/me', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const d = await env.DB.prepare(`select id, label, on_date from special_dates where user_id = ? order by on_date`).bind(u.id).all<{ id: string; label: string; on_date: string }>();
  return json(publicUser(u, d.results));
});

route('PATCH', '/api/me', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  const sets: string[] = []; const vals: unknown[] = [];
  if ('name' in b) { sets.push('name = ?'); vals.push(str(b.name, 60, 'Name', true)); }
  if ('birthday' in b) { sets.push('birthday = ?'); vals.push(b.birthday ? validDate(String(b.birthday), 'Birthday') : null); }
  if ('email' in b) {
    const e = str(b.email, 120, 'Email');
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'Enter a valid email address.');
    sets.push('email = ?'); vals.push(e);
  }
  if ('diet' in b) {
    const d = str(b.diet, 20, 'Food preference');
    if (d && !['Vegetarian', 'Eggetarian', 'Non-vegetarian', 'Vegan'].includes(d)) throw new HttpError(400, 'Unknown food preference.');
    sets.push('diet = ?'); vals.push(d);
  }
  if ('fav_order' in b) { sets.push('fav_order = ?'); vals.push(str(b.fav_order, 40, 'Usual order')); }
  if ('prefs' in b) {
    const merged = { ...JSON.parse(u.prefs) };
    for (const k of ['stamps', 'offers', 'treats', 'geo']) {
      const v = (b.prefs as Record<string, unknown> | null)?.[k];
      if (typeof v === 'boolean') merged[k] = v;
    }
    sets.push('prefs = ?'); vals.push(JSON.stringify(merged));
  }
  if (sets.length) await env.DB.prepare(`update users set ${sets.join(', ')} where id = ?`).bind(...vals, u.id).run();
  const fresh = await env.DB.prepare(`select * from users where id = ?`).bind(u.id).first<User>();
  return json(publicUser(fresh!));
});

route('PUT', '/api/me/special-dates', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body<{ dates?: { label?: string; on_date?: string }[] }>(req);
  const dates = Array.isArray(b.dates) ? b.dates : [];
  if (dates.length > 5) throw new HttpError(400, 'You can save up to 5 special days.');
  const stmts = [env.DB.prepare(`delete from special_dates where user_id = ?`).bind(u.id)];
  for (const d of dates) {
    const on = String(d.on_date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on))) throw new HttpError(400, 'Each special day needs a valid date.');
    stmts.push(env.DB.prepare(`insert into special_dates (id, user_id, label, on_date) values (?, ?, ?, ?)`).bind(uuid(), u.id, str(d.label, 24, 'Label') ?? 'Special day', on));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
});

route('PUT', '/api/me/photo', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const img = await readImage(req);
  const key = `avatars/${u.id}/${Date.now()}.${img.ext}`;
  await env.MEDIA.put(key, img.bytes, { httpMetadata: { contentType: img.type } });
  await env.DB.prepare(`update users set photo_key = ? where id = ?`).bind(key, u.id).run();
  if (u.photo_key) await env.MEDIA.delete(u.photo_key);
  return json({ photo_url: `/api/media/${key}` });
});

route('DELETE', '/api/me/photo', async ({ req, env }) => {
  const u = await requireUser(req, env);
  if (u.photo_key) await env.MEDIA.delete(u.photo_key);
  await env.DB.prepare(`update users set photo_key = null where id = ?`).bind(u.id).run();
  return json({ ok: true });
});

// Delete my account and everything attached to it.
route('DELETE', '/api/me', async ({ req, env }) => {
  const u = await requireUser(req, env);
  if (u.photo_key) await env.MEDIA.delete(u.photo_key);
  await env.DB.prepare(`delete from users where id = ?`).bind(u.id).run(); // cascades to cards, sessions, dates
  return json({ ok: true }, 200, { 'set-cookie': 'cl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
});

// --- files in R2 ---
route('GET', '/api/media/*key', async ({ req, env, p }) => {
  const key = decodeURIComponent(p.key);
  if (key.includes('..')) throw new HttpError(400, 'Bad path.');
  let cache = 'public, max-age=86400';
  if (key.startsWith('avatars/')) {
    const u = await requireUser(req, env);
    if (key.split('/')[1] !== u.id) throw new HttpError(403, 'Not allowed.');
    cache = 'private, max-age=3600';
  } else if (!key.startsWith('cafe-media/')) throw new HttpError(404, 'Not found.');
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new HttpError(404, 'Not found.');
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': cache, etag: obj.httpEtag } });
});

// --- cafes (anyone can browse) ---
route('GET', '/api/cafes/nearby', async ({ env, url }) => {
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Send lat and lng.');
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 20, 50));
  // Narrow to roughly 0.6 degrees (about 65 km) first, then sort by exact distance. Fine until you have thousands of cafes.
  const rows = await env.DB.prepare(`select * from cafes where is_active = 1 and lat between ? and ? and lng between ? and ?`)
    .bind(lat - 0.6, lat + 0.6, lng - 0.6, lng + 0.6).all<CafeRow>();
  const list = rows.results.map((c) => ({ ...publicCafe(c), distance_m: Math.round(distanceM(lat, lng, c.lat, c.lng)) }))
    .sort((a, b) => a.distance_m - b.distance_m).slice(0, limit);
  return json({ cafes: list });
});

route('GET', '/api/cafes/:id', async ({ env, p }) => {
  const c = await env.DB.prepare(`select * from cafes where id = ? and is_active = 1`).bind(p.id).first<CafeRow>();
  if (!c) throw new HttpError(404, 'Cafe not found.');
  const offers = await env.DB.prepare(`select id, title, ends_at from offers where cafe_id = ? and is_active = 1 and (ends_at is null or ends_at > ?)`).bind(p.id, now()).all();
  return json({ ...publicCafe(c), offers: offers.results });
});

route('GET', '/api/offers', async ({ env }) => {
  const r = await env.DB.prepare(
    `select o.id, o.title, o.ends_at, c.id as cafe_id, c.name as cafe_name from offers o join cafes c on c.id = o.cafe_id
     where o.is_active = 1 and c.is_active = 1 and (o.ends_at is null or o.ends_at > ?) order by o.ends_at`).bind(now()).all();
  return json({ offers: r.results });
});

// --- my loyalty cards ---
route('POST', '/api/cafes/:id/join', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  const b = await body(req).catch(() => ({} as Record<string, unknown>));
  const optIn = b.offers === false ? 0 : 1;
  const c = await env.DB.prepare(`select id from cafes where id = ? and is_active = 1`).bind(p.id).first();
  if (!c) throw new HttpError(404, 'Cafe not found.');
  await env.DB.prepare(`insert into memberships (id, user_id, cafe_id, member_code, offers_opt_in) values (?, ?, ?, ?, ?)
                        on conflict(user_id, cafe_id) do update set offers_opt_in = excluded.offers_opt_in`)
    .bind(uuid(), u.id, p.id, memberCode(), optIn).run();
  const m = await env.DB.prepare(`select id, cafe_id, member_code, stamps, rewards_redeemed, offers_opt_in, joined_at from memberships where user_id = ? and cafe_id = ?`).bind(u.id, p.id).first();
  return json(m, 201);
});

route('GET', '/api/memberships', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const r = await env.DB.prepare(
    `select m.id as membership_id, m.member_code, m.stamps, m.rewards_redeemed, m.offers_opt_in, m.joined_at, c.*
     from memberships m join cafes c on c.id = m.cafe_id where m.user_id = ? order by m.joined_at`).bind(u.id).all<CafeRow & { membership_id: string; member_code: string; stamps: number; rewards_redeemed: number; offers_opt_in: number; joined_at: string }>();
  return json({ cards: r.results.map((x) => ({
    id: x.membership_id, member_code: x.member_code, stamps: x.stamps, rewards_redeemed: x.rewards_redeemed,
    offers_opt_in: !!x.offers_opt_in, joined_at: x.joined_at, cafe: publicCafe(x),
  })) });
});

route('PATCH', '/api/memberships/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  if (typeof b.offers !== 'boolean') throw new HttpError(400, 'Send {"offers": true or false}.');
  const r = await env.DB.prepare(`update memberships set offers_opt_in = ? where id = ? and user_id = ?`).bind(b.offers ? 1 : 0, p.id, u.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Card not found.');
  return json({ ok: true });
});

route('DELETE', '/api/memberships/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await env.DB.prepare(`delete from memberships where id = ? and user_id = ?`).bind(p.id, u.id).run();
  return json({ ok: true });
});

route('POST', '/api/saved-offers/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await env.DB.prepare(`insert or ignore into saved_offers (user_id, offer_id) values (?, ?)`).bind(u.id, p.id).run();
  return json({ ok: true });
});
route('DELETE', '/api/saved-offers/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await env.DB.prepare(`delete from saved_offers where user_id = ? and offer_id = ?`).bind(u.id, p.id).run();
  return json({ ok: true });
});

// --- nearby alerts: the phone asks before showing a popup. Max 2 a day in total (India time). ---
route('POST', '/api/geo-alerts', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  const cafeId = str(b.cafe_id, 64, 'cafe_id', true)!;
  if (JSON.parse(u.prefs).geo === false) return json({ allowed: false, reason: 'off' });
  const used = await env.DB.prepare(`select count(*) as n from geo_alerts where user_id = ? and sent_at >= ?`).bind(u.id, istDayStart()).first<{ n: number }>();
  if ((used?.n ?? 0) >= GEO_DAILY_CAP) return json({ allowed: false, reason: 'daily_limit', used: used?.n });
  await env.DB.prepare(`insert into geo_alerts (user_id, cafe_id, sent_at) values (?, ?, ?)`).bind(u.id, cafeId, now()).run();
  return json({ allowed: true, used: (used?.n ?? 0) + 1, cap: GEO_DAILY_CAP });
});

route('POST', '/api/devices', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  const token = str(b.token, 400, 'token', true)!;
  const platform = String(b.platform);
  if (!['android', 'ios', 'web'].includes(platform)) throw new HttpError(400, 'platform must be android, ios or web.');
  await env.DB.prepare(`insert into device_tokens (token, user_id, platform, updated_at) values (?, ?, ?, ?)
                        on conflict(token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at`)
    .bind(token, u.id, platform, now()).run();
  return json({ ok: true });
});

// --- staff app: scan, stamp, redeem, clock in and out ---
async function cardByCode(env: Env, raw: unknown) {
  const code = String(raw ?? '').trim().toUpperCase();
  const m = await env.DB.prepare(`select m.id, m.cafe_id, m.stamps, c.stamp_goal from memberships m join cafes c on c.id = m.cafe_id where m.member_code = ?`)
    .bind(code).first<{ id: string; cafe_id: string; stamps: number; stamp_goal: number }>();
  if (!m) throw new HttpError(404, 'Card not found.');
  return m;
}

route('POST', '/api/staff/stamp', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  const m = await cardByCode(env, b.code);
  await requireStaff(env, u.id, m.cafe_id);
  const room = m.stamp_goal - m.stamps;
  if (room <= 0) throw new HttpError(409, 'The card is full. Give the reward first.');
  const qty = Math.min(Math.max(1, Math.min(Number(b.qty) || 1, 10)), room); // never count more stamps than were really added
  await env.DB.batch([
    env.DB.prepare(`update memberships set stamps = min(stamps + ?, ?) where id = ?`).bind(qty, m.stamp_goal, m.id),
    env.DB.prepare(`insert into stamp_events (membership_id, cafe_id, staff_user_id, kind, qty, created_at) values (?, ?, ?, 'stamp', ?, ?)`).bind(m.id, m.cafe_id, u.id, qty, now()),
  ]);
  const fresh = await env.DB.prepare(`select stamps, rewards_redeemed from memberships where id = ?`).bind(m.id).first<{ stamps: number; rewards_redeemed: number }>();
  return json({ ...fresh, stamp_goal: m.stamp_goal, reward_ready: (fresh?.stamps ?? 0) >= m.stamp_goal });
});

route('POST', '/api/staff/redeem', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  const m = await cardByCode(env, b.code);
  await requireStaff(env, u.id, m.cafe_id);
  const r = await env.DB.prepare(`update memberships set stamps = stamps - ?, rewards_redeemed = rewards_redeemed + 1 where id = ? and stamps >= ?`).bind(m.stamp_goal, m.id, m.stamp_goal).run();
  if (!r.meta.changes) throw new HttpError(409, 'The card is not full yet.');
  await env.DB.prepare(`insert into stamp_events (membership_id, cafe_id, staff_user_id, kind, qty, created_at) values (?, ?, ?, 'redeem', 1, ?)`).bind(m.id, m.cafe_id, u.id, now()).run();
  const fresh = await env.DB.prepare(`select stamps, rewards_redeemed from memberships where id = ?`).bind(m.id).first();
  return json({ ...fresh, stamp_goal: m.stamp_goal });
});

route('POST', '/api/staff/clock-in', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const cafeId = str((await body(req)).cafe_id, 64, 'cafe_id', true)!;
  const s = await requireStaff(env, u.id, cafeId);
  const open = await env.DB.prepare(`select id from shifts where staff_id = ? and clock_out is null`).bind(s.id).first();
  if (open) throw new HttpError(409, 'You are already clocked in.');
  const id = uuid(), t = now();
  await env.DB.prepare(`insert into shifts (id, staff_id, clock_in) values (?, ?, ?)`).bind(id, s.id, t).run();
  return json({ id, clock_in: t }, 201);
});

route('POST', '/api/staff/clock-out', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const cafeId = str((await body(req)).cafe_id, 64, 'cafe_id', true)!;
  const s = await requireStaff(env, u.id, cafeId);
  const t = now();
  const r = await env.DB.prepare(`update shifts set clock_out = ? where staff_id = ? and clock_out is null`).bind(t, s.id).run();
  if (!r.meta.changes) throw new HttpError(409, 'You are not clocked in.');
  return json({ clock_out: t });
});

route('GET', '/api/staff/me', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const r = await env.DB.prepare(
    `select s.id as staff_id, s.role, c.id as cafe_id, c.name,
       (select clock_in from shifts where staff_id = s.id and clock_out is null) as clocked_in_since
     from staff s join cafes c on c.id = s.cafe_id where s.user_id = ? and s.is_active = 1`).bind(u.id).all();
  return json({ jobs: r.results });
});

// --- owner app: create and manage a cafe ---
route('POST', '/api/cafes', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'lat and lng are required.');
  const kind = b.kind === 'restaurant' ? 'restaurant' : 'cafe';
  const id = uuid();
  // For paying clients only: you may prefer to create cafes yourself, or insert with is_active = 0 until the plan is paid.
  await env.DB.batch([
    env.DB.prepare(`insert into cafes (id, owner_id, name, kind, area, city, lat, lng, opens, closes, brand, stamp_goal, reward_text)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, u.id, str(b.name, 80, 'Name', true), kind, str(b.area, 60, 'Area'), str(b.city, 60, 'City') ?? 'Mysuru', lat, lng,
        str(b.opens, 5, 'opens'), str(b.closes, 5, 'closes'), b.brand ? cleanBrand(b.brand) : '{"bg":"#0b0b0b","ink":"#fafafa","acc":"#d9a066","pattern":"dots"}',
        Math.max(1, Math.min(Number(b.stamp_goal) || 8, 20)), str(b.reward_text, 60, 'reward_text') ?? 'Free filter coffee'),
    env.DB.prepare(`insert into staff (id, cafe_id, user_id, role) values (?, ?, ?, 'owner')`).bind(uuid(), id, u.id),
  ]);
  return json({ id }, 201);
});

route('PATCH', '/api/cafes/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await requireManager(env, u.id, p.id);
  const b = await body(req);
  const sets: string[] = []; const vals: unknown[] = [];
  if ('name' in b) { sets.push('name = ?'); vals.push(str(b.name, 80, 'Name', true)); }
  if ('area' in b) { sets.push('area = ?'); vals.push(str(b.area, 60, 'Area')); }
  if ('opens' in b) { sets.push('opens = ?'); vals.push(str(b.opens, 5, 'opens')); }
  if ('closes' in b) { sets.push('closes = ?'); vals.push(str(b.closes, 5, 'closes')); }
  if ('reward_text' in b) { sets.push('reward_text = ?'); vals.push(str(b.reward_text, 60, 'reward_text', true)); }
  if ('stamp_goal' in b) { sets.push('stamp_goal = ?'); vals.push(Math.max(1, Math.min(Number(b.stamp_goal) || 8, 20))); }
  if ('brand' in b) { sets.push('brand = ?'); vals.push(cleanBrand(b.brand)); }
  if (sets.length) await env.DB.prepare(`update cafes set ${sets.join(', ')} where id = ?`).bind(...vals, p.id).run();
  return json({ ok: true });
});

route('POST', '/api/cafes/:id/photos', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await requireManager(env, u.id, p.id);
  const c = await env.DB.prepare(`select photo_keys from cafes where id = ?`).bind(p.id).first<{ photo_keys: string }>();
  const keys: string[] = JSON.parse(c?.photo_keys ?? '[]');
  if (keys.length >= 8) throw new HttpError(400, 'A cafe can have up to 8 photos.');
  const img = await readImage(req);
  const key = `cafe-media/${p.id}/${Date.now()}.${img.ext}`;
  await env.MEDIA.put(key, img.bytes, { httpMetadata: { contentType: img.type } });
  keys.push(key);
  await env.DB.prepare(`update cafes set photo_keys = ? where id = ?`).bind(JSON.stringify(keys), p.id).run();
  return json({ url: `/api/media/${key}` }, 201);
});

route('POST', '/api/cafes/:id/offers', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await requireManager(env, u.id, p.id);
  const b = await body(req);
  const id = uuid();
  await env.DB.prepare(`insert into offers (id, cafe_id, title, ends_at) values (?, ?, ?, ?)`).bind(id, p.id, str(b.title, 100, 'Title', true), str(b.ends_at, 30, 'ends_at')).run();
  return json({ id }, 201);
});

route('POST', '/api/cafes/:id/staff', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await requireManager(env, u.id, p.id);
  const b = await body(req);
  const phone = normalizePhone(b.phone);
  const role = b.role === 'manager' ? 'manager' : 'staff';
  await env.DB.prepare(`insert into users (id, phone) values (?, ?) on conflict(phone) do nothing`).bind(uuid(), phone).run();
  const target = await env.DB.prepare(`select id from users where phone = ?`).bind(phone).first<{ id: string }>();
  await env.DB.prepare(`insert into staff (id, cafe_id, user_id, role, hourly_rate) values (?, ?, ?, ?, ?)
                        on conflict(cafe_id, user_id) do update set role = excluded.role, hourly_rate = excluded.hourly_rate, is_active = 1`)
    .bind(uuid(), p.id, target!.id, role, Math.max(0, Number(b.hourly_rate) || 0)).run();
  return json({ ok: true }, 201);
});

route('GET', '/api/cafes/:id/stats', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await requireStaff(env, u.id, p.id);
  const r = await env.DB.prepare(
    `select (select count(*) from memberships where cafe_id = ?1) as members,
            (select coalesce(sum(qty), 0) from stamp_events where cafe_id = ?1 and kind = 'stamp' and created_at >= ?2) as stamps_today,
            (select count(*) from stamp_events where cafe_id = ?1 and kind = 'redeem') as rewards_redeemed`).bind(p.id, istDayStart()).first();
  return json(r);
});

route('GET', '/api/cafes/:id/payroll', async ({ req, env, p, url }) => {
  const u = await requireUser(req, env);
  await requireManager(env, u.id, p.id);
  const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpError(400, 'Send from and to as YYYY-MM-DD.');
  const start = new Date(Date.parse(from + 'T00:00:00+05:30')).toISOString();
  const end = new Date(Date.parse(to + 'T00:00:00+05:30') + 86400_000).toISOString();
  const r = await env.DB.prepare(
    `select s.id as staff_id, u.name, u.phone, s.role, s.hourly_rate,
       round(coalesce(sum((julianday(coalesce(sh.clock_out, ?3)) - julianday(sh.clock_in)) * 24), 0), 2) as hours
     from staff s join users u on u.id = s.user_id
     left join shifts sh on sh.staff_id = s.id and sh.clock_in >= ?1 and sh.clock_in < ?2
     where s.cafe_id = ?4 group by s.id`).bind(start, end, now(), p.id).all<{ hours: number; hourly_rate: number }>();
  return json({ from, to, rows: r.results.map((x) => ({ ...x, pay: Math.round(x.hours * x.hourly_rate * 100) / 100 })) });
});

// ---------- entry point ----------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      for (const [method, re, handler] of routes) {
        if (req.method !== method) continue;
        const m = re.exec(url.pathname);
        if (m) return await handler({ req, env, url, p: { ...m.groups } });
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Unknown endpoint.');
      return env.ASSETS ? env.ASSETS.fetch(req) : json({ error: 'Not found.' }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
