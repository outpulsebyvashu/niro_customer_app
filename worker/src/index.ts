/**
 * Cafe Loyalty API, running on Cloudflare Workers with D1 (database) and R2 (files).
 * The app itself is the Next.js project in the repo root. This Worker is only the API.
 *
 * D1 has no row-level security, so every permission check is in this file:
 *  - customers can read and change only their own data
 *  - stamps change only through /api/staff/stamp and /api/staff/redeem, which check the caller works at that cafe
 *  - owners and managers manage their own cafe only
 */

import { SCHEMA_STATEMENTS, SEED_STATEMENTS } from './sql.ts';

export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;        // photo storage (R2). Optional: without it, photo features answer 503 and everything else works
  ASSETS?: Fetcher;       // not used when the app is hosted separately
  SEED_SAMPLE?: string;    // "1" = add five sample cafes when the tables are first created (development only)
  ADMIN_PHONES?: string;   // comma-separated mobile numbers allowed to use the admin page, e.g. 9876543210
  DEV_OTP?: string;        // "1" = skip SMS, every code is 123456 (testing only)
  STARTMESSAGING_API_KEY?: string; // secret: the StartMessaging API key (sm_live_...). Preferred provider when set.
  TWILIO_SID?: string;     // secrets: wrangler secret put TWILIO_SID, etc.
  TWILIO_TOKEN?: string;
  TWILIO_FROM?: string;
  GOOGLE_WALLET_ISSUER_ID?: string;  // Google Wallet: issuer id from pay.google.com/business/console
  GOOGLE_WALLET_SA_EMAIL?: string;   // Google Wallet: service account email
  GOOGLE_WALLET_PRIVATE_KEY?: string; // secret: service account private key (the -----BEGIN PRIVATE KEY----- text)
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


// ---------- first-use database setup ----------
// If the D1 database is empty, create the tables (and the sample cafes) automatically.
// This lets you set up from a phone with no SQL pasting. Later changes still go in migrations/.
const SUPPORT_TABLE = `create table if not exists support_messages (
  id text primary key, user_id text, contact text, message text not null, ip_hash text not null,
  status text not null default 'open', created_at text not null)`;
const LIVE_TABLE = `create table if not exists live_events (
  id integer primary key autoincrement, user_id text not null, kind text not null, cafe_name text, qty integer, created_at text not null)`;
const LIVE_INDEX = `create index if not exists live_events_user on live_events (user_id, id)`;
// Billing (same as migrations/0002_billing.sql)
const BILLING_TABLES = [
  `create table if not exists invoices (
    id text primary key, seq integer not null unique, number text not null unique,
    cafe_id text references cafes(id) on delete set null, seller text not null default '{}', bill_to text not null, items text not null,
    tax_name text not null default 'GST', tax_rate real not null default 18,
    subtotal real not null, tax real not null, total real not null,
    issued_on text not null, due_on text not null, period_start text, period_end text,
    status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')), paid_on text, note text,
    style text not null default 'paper' check (style in ('paper', 'block', 'term')), created_by text, created_at text not null)`,
  `create index if not exists invoices_cafe on invoices (cafe_id, issued_on)`,
  `create index if not exists invoices_status on invoices (status, due_on)`,
  `create table if not exists billing_settings (id integer primary key check (id = 1), data text not null)`,
];
let dbReady: Promise<void> | null = null;
async function tablesExist(env: Env): Promise<boolean> {
  const t = await env.DB.prepare(`select name from sqlite_master where type = 'table' and name = 'users'`).first();
  return !!t;
}
function ensureDb(env: Env): Promise<void> {
  if (!dbReady) {
    dbReady = (async () => {
      if (!(await tablesExist(env))) {
        try {
          await env.DB.batch(SCHEMA_STATEMENTS.map((q) => env.DB.prepare(q)));
          if (env.SEED_SAMPLE === '1') await env.DB.batch(SEED_STATEMENTS.map((q) => env.DB.prepare(q)));
        } catch (e) {
          if (!(await tablesExist(env))) throw e; // another request may have created them at the same moment
        }
      }
      // Tables added after the first release: created here for databases that already exist.
      await env.DB.prepare(SUPPORT_TABLE).run();
      await env.DB.prepare(LIVE_TABLE).run();
      await env.DB.prepare(LIVE_INDEX).run();
      for (const q of BILLING_TABLES) await env.DB.prepare(q).run();
      // The five sample cafes from the first demo are not real. Remove them unless sample data was asked for.
      if (env.SEED_SAMPLE !== '1') await env.DB.prepare(`delete from cafes where id in ('agr','kaa','cru','cha','waf') and owner_id is null`).run();
    })().catch((e) => { dbReady = null; throw e; });
  }
  return dbReady;
}

// ---------- small helpers ----------
function media(env: Env): R2Bucket {
  if (!env.MEDIA) throw new HttpError(503, 'Photo storage is not set up yet.');
  return env.MEDIA;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers } });

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
  const text = await req.text();
  if (text.length > 20_000) throw new HttpError(413, 'Request is too large.');
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0;
    return v as T;
  } catch { throw new HttpError(400, 'Send a JSON body.'); }
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

function endsAt(v: unknown): string | null {
  const t = str(v, 30, 'ends_at');
  if (t && Number.isNaN(Date.parse(t))) throw new HttpError(400, 'ends_at must be a date.');
  return t ? new Date(t).toISOString() : null;
}
const hhmm = (v: unknown, f: string) => {
  const t = str(v, 5, f);
  if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new HttpError(400, `${f} must be HH:MM.`);
  return t;
};

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
// The fixed test code (123456) is honoured only when the request really comes from localhost.
// On a live site DEV_OTP is ignored, so a forgotten setting can never let anyone sign in as someone else.
const isLocal = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';
const devOtp = (env: Env, url: URL) => env.DEV_OTP === '1' && isLocal(url);

async function sendOtp(env: Env, phone: string, code: string, url: URL): Promise<void> {
  if (devOtp(env, url)) return;
  if (env.STARTMESSAGING_API_KEY) {
    // StartMessaging: no DLT paperwork needed. We make and check the code ourselves, they only deliver it.
    const res = await fetch('https://api.startmessaging.com/otp/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.STARTMESSAGING_API_KEY },
      body: JSON.stringify({ phoneNumber: phone, variables: { otp: code, appName: 'Niro' } }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res || !res.ok) {
      if (res) console.error('startmessaging', res.status, (await res.text().catch(() => '')).slice(0, 200));
      throw new HttpError(502, 'Could not send the SMS. Try again.');
    }
    return;
  }
  if (!env.TWILIO_SID || !env.TWILIO_TOKEN || !env.TWILIO_FROM) throw new HttpError(500, 'SMS is not set up yet.');
  // Twilio shown as the example. To use MSG91, Textlocal or another Indian provider, replace this call.
  // India requires DLT registration of the sender ID and message template.
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: phone, From: env.TWILIO_FROM, Body: `${code} is your Niro code. It expires in ${OTP_MINUTES} minutes. Do not share it.\n\n@${url.host} #${code}` }),
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
// Staff check for a scanned card: a card from another cafe looks exactly like a card that does not exist,
// and staff cannot stamp or redeem their own card.
async function requireStaffForCard(env: Env, userId: string, m: { cafe_id: string; user_id: string }) {
  const s = await staffRow(env, userId, m.cafe_id);
  if (!s) throw new HttpError(404, 'Card not found.');
  if (m.user_id === userId) throw new HttpError(403, 'You cannot stamp your own card.');
  return s;
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

function isAdmin(env: Env, u: User): boolean {
  const list = (env.ADMIN_PHONES ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { try { return normalizePhone(x); } catch { return ''; } });
  return list.includes(u.phone);
}
async function requireAdmin(req: Request, env: Env): Promise<User> {
  const u = await requireUser(req, env);
  if (!isAdmin(env, u)) throw new HttpError(403, 'Admins only.');
  return u;
}
async function meJson(env: Env, u: User) {
  const d = await env.DB.prepare(`select id, label, on_date from special_dates where user_id = ? order by on_date`).bind(u.id).all<{ id: string; label: string; on_date: string }>();
  const g = await env.DB.prepare(`select count(*) as n from geo_alerts where user_id = ? and sent_at >= ?`).bind(u.id, istDayStart()).first<{ n: number }>();
  return { ...publicUser(u, d.results), geo_used_today: g?.n ?? 0, geo_cap: GEO_DAILY_CAP, photos_enabled: !!env.MEDIA, google_wallet: walletReady(env), is_admin: isAdmin(env, u) };
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
  const h = new Uint8Array(bytes.slice(0, 12));
  const ok = ext === 'jpg' ? h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff
    : ext === 'png' ? h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47
    : h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50;
  if (!ok) throw new HttpError(415, 'That file is not a real image.');
  return { bytes, ext, type };
}

/** A pixel design for the card: a small grid (up to 64 x 40) and up to 16 colours. d has one character (0-9, a-f) per pixel. */
function cleanArt(a: unknown) {
  const o = a as Record<string, unknown>;
  const w = Number(o?.w), h = Number(o?.h), p = o?.p, d = o?.d;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 4 || h < 4 || w > 64 || h > 40) throw new HttpError(400, 'Card design size is not valid.');
  if (!Array.isArray(p) || p.length < 1 || p.length > 16 || !p.every((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))) throw new HttpError(400, 'Card design colours are not valid.');
  if (typeof d !== 'string' || d.length !== w * h || !new RegExp(`^[0-${p.length > 10 ? '9a-' + (p.length - 1).toString(16) : p.length - 1}]+$`).test(d)) throw new HttpError(400, 'Card design pixels are not valid.');
  return { w, h, p, d };
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
  const out: Record<string, unknown> = { bg: hex(o.bg, 'bg'), ink: hex(o.ink, 'ink'), acc: hex(o.acc, 'acc'), pattern };
  if (o.art) out.art = cleanArt(o.art);
  return JSON.stringify(out);
}

// ---------- routes ----------
type Ctx = { req: Request; env: Env; url: URL; p: Record<string, string> };
type Handler = (c: Ctx) => Promise<Response>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)').replace(/\*(\w+)/, '(?<$1>.+)') + '$'), h]);

// --- sign in ---
route('POST', '/api/auth/request-otp', async ({ req, env, url }) => {
  const b = await body(req);
  const phone = normalizePhone(b.phone);
  const name = str(b.name, 60, 'Name');
  // Per-IP limit (stops one device from texting many numbers). Stored in the same table under an "ip:" key.
  const ipKey = 'ip:' + (req.headers.get('cf-connecting-ip') ?? 'unknown');
  const ipRecent = await env.DB.prepare(`select count(*) as n from otp_requests where phone = ? and created_at > ?`)
    .bind(ipKey, new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>();
  if ((ipRecent?.n ?? 0) >= 60) throw new HttpError(429, 'Too many requests from this device. Try again later.');
  const recent = await env.DB.prepare(`select created_at from otp_requests where phone = ? and created_at > ? order by created_at desc`)
    .bind(phone, new Date(Date.now() - 3600_000).toISOString()).all<{ created_at: string }>();
  if (recent.results.length >= 5) throw new HttpError(429, 'Too many codes requested. Try again in an hour.');
  if (recent.results[0] && Date.now() - Date.parse(recent.results[0].created_at) < 30_000) throw new HttpError(429, 'Wait 30 seconds before asking for another code.');

  const code = devOtp(env, url) ? '123456' : otpCode();
  await env.DB.batch([
    env.DB.prepare(`insert into otp_codes (phone, code_hash, name, attempts, expires_at) values (?, ?, ?, 0, ?)
                    on conflict(phone) do update set code_hash = excluded.code_hash, name = excluded.name, attempts = 0, expires_at = excluded.expires_at`)
      .bind(phone, await sha256(phone + ':' + code), name, new Date(Date.now() + OTP_MINUTES * 60_000).toISOString()),
    env.DB.prepare(`insert into otp_requests (phone, created_at) values (?, ?)`).bind(phone, now()),
    env.DB.prepare(`insert into otp_requests (phone, created_at) values (?, ?)`).bind(ipKey, now()),
    env.DB.prepare(`delete from otp_requests where created_at < ?`).bind(new Date(Date.now() - 86400_000).toISOString()),
  ]);
  await sendOtp(env, phone, code, url);
  return json({ ok: true, expires_in: OTP_MINUTES * 60, dev: devOtp(env, url) ? 'Testing mode: the code is 123456' : undefined });
});

route('POST', '/api/auth/verify', async ({ req, env, url }) => {
  const b = await body(req);
  const phone = normalizePhone(b.phone);
  const code = String(b.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the 6-digit code.');
  const row = await env.DB.prepare(`select code_hash, name, attempts, expires_at from otp_codes where phone = ?`)
    .bind(phone).first<{ code_hash: string; name: string | null; attempts: number; expires_at: string }>();
  if (!row || row.expires_at < now()) throw new HttpError(400, 'That code has expired. Ask for a new one.');
  // Count the try first, in one atomic step, so parallel guesses cannot get past the 5-try limit.
  const tried = await env.DB.prepare(`update otp_codes set attempts = attempts + 1 where phone = ? and attempts < 5`).bind(phone).run();
  if (!tried.meta.changes) throw new HttpError(429, 'Too many wrong tries. Ask for a new code.');
  if ((await sha256(phone + ':' + code)) !== row.code_hash) throw new HttpError(400, 'That code is not right.');
  // Use the code exactly once, even if two correct requests arrive together.
  const used = await env.DB.prepare(`delete from otp_codes where phone = ? and code_hash = ?`).bind(phone, row.code_hash).run();
  if (!used.meta.changes) throw new HttpError(400, 'That code has expired. Ask for a new one.');

  await env.DB.prepare(`insert into users (id, phone, name) values (?, ?, ?) on conflict(phone) do nothing`).bind(uuid(), phone, row.name ?? '').run();
  if (row.name) await env.DB.prepare(`update users set name = ? where phone = ? and name = ''`).bind(row.name, phone).run();
  const user = await env.DB.prepare(`select * from users where phone = ?`).bind(phone).first<User>();
  if (!user) throw new HttpError(500, 'Could not create your account.');

  await env.DB.prepare(`delete from sessions where expires_at < ?`).bind(now()).run();
  const token = randomToken();
  await env.DB.prepare(`insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)`)
    .bind(await sha256(token), user.id, new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()).run();
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return json({ token, user: await meJson(env, user) }, 200, {
    'set-cookie': `cl_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`,
  });
});

route('POST', '/api/auth/logout', async ({ req, env }) => {
  const t = tokenFrom(req);
  if (t) await env.DB.prepare(`delete from sessions where token_hash = ?`).bind(await sha256(t)).run();
  return json({ ok: true }, 200, { 'set-cookie': 'cl_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
});

// --- my profile ---
route('GET', '/api/me', async ({ req, env }) => {
  const u = await requireUser(req, env);
  return json(await meJson(env, u));
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
  return json(await meJson(env, fresh!));
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
  await media(env).put(key, img.bytes, { httpMetadata: { contentType: img.type } });
  await env.DB.prepare(`update users set photo_key = ? where id = ?`).bind(key, u.id).run();
  if (u.photo_key && env.MEDIA) await env.MEDIA.delete(u.photo_key);
  return json({ photo_url: `/api/media/${key}` });
});

route('DELETE', '/api/me/photo', async ({ req, env }) => {
  const u = await requireUser(req, env);
  if (u.photo_key && env.MEDIA) await env.MEDIA.delete(u.photo_key);
  await env.DB.prepare(`update users set photo_key = null where id = ?`).bind(u.id).run();
  return json({ ok: true });
});

// Delete my account and everything attached to it.
route('DELETE', '/api/me', async ({ req, env }) => {
  const u = await requireUser(req, env);
  if (u.photo_key && env.MEDIA) await env.MEDIA.delete(u.photo_key);
  await env.DB.prepare(`delete from support_messages where user_id = ?`).bind(u.id).run();
  await env.DB.prepare(`delete from live_events where user_id = ?`).bind(u.id).run();
  await env.DB.prepare(`delete from users where id = ?`).bind(u.id).run(); // cascades to cards, sessions, dates
  return json({ ok: true }, 200, { 'set-cookie': 'cl_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
});

// --- files in R2 ---
route('GET', '/api/media/*key', async ({ req, env, p }) => {
  let key: string;
  try { key = decodeURIComponent(p.key); } catch { throw new HttpError(400, 'Bad path.'); }
  if (key.includes('..') || key.includes('\\')) throw new HttpError(400, 'Bad path.');
  let cache = 'public, max-age=86400';
  if (key.startsWith('avatars/')) {
    const u = await requireUser(req, env);
    if (key.split('/')[1] !== u.id) throw new HttpError(403, 'Not allowed.');
    cache = 'private, max-age=3600';
  } else if (!key.startsWith('cafe-media/')) throw new HttpError(404, 'Not found.');
  const obj = await media(env).get(key);
  if (!obj) throw new HttpError(404, 'Not found.');
  return new Response(obj.body, { headers: { 'content-type': IMAGE_TYPES[obj.httpMetadata?.contentType ?? ''] ? obj.httpMetadata!.contentType! : 'application/octet-stream', 'cache-control': cache, etag: obj.httpEtag,
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin' } });
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
  let offers: { id: string; cafe_id: string; title: string; ends_at: string | null }[] = [];
  if (list.length) {
    const marks = list.map(() => '?').join(',');
    offers = (await env.DB.prepare(`select id, cafe_id, title, ends_at from offers where is_active = 1 and (ends_at is null or ends_at > ?) and cafe_id in (${marks}) order by ends_at`)
      .bind(now(), ...list.map((c) => c.id)).all<{ id: string; cafe_id: string; title: string; ends_at: string | null }>()).results;
  }
  return json({ cafes: list.map((c) => ({ ...c, offers: offers.filter((o) => o.cafe_id === c.id) })) });
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

route('GET', '/api/saved-offers', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const r = await env.DB.prepare(
    `select o.id, o.title, o.ends_at, c.id as cafe_id, c.name as cafe_name from saved_offers s
       join offers o on o.id = s.offer_id join cafes c on c.id = o.cafe_id
     where s.user_id = ? and o.is_active = 1 and c.is_active = 1 and (o.ends_at is null or o.ends_at > ?)`).bind(u.id, now()).all<{ id: string }>();
  return json({ offers: r.results, ids: r.results.map((x) => x.id) });
});
route('POST', '/api/saved-offers/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  const o = await env.DB.prepare(`select id from offers where id = ? and is_active = 1`).bind(p.id).first();
  if (!o) throw new HttpError(404, 'Offer not found.');
  await env.DB.prepare(`insert or ignore into saved_offers (user_id, offer_id) values (?, ?)`).bind(u.id, p.id).run();
  return json({ ok: true });
});
route('DELETE', '/api/saved-offers/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await env.DB.prepare(`delete from saved_offers where user_id = ? and offer_id = ?`).bind(u.id, p.id).run();
  return json({ ok: true });
});

// --- Google Wallet: "Add to Google Wallet" link for one loyalty card ---
const walletReady = (env: Env) => !!(env.GOOGLE_WALLET_ISSUER_ID && env.GOOGLE_WALLET_SA_EMAIL && env.GOOGLE_WALLET_PRIVATE_KEY);
const b64u = (b: ArrayBuffer | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  let t = ''; for (const x of bytes) t += String.fromCharCode(x);
  return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
async function signRs256(pem: string, data: string): Promise<string> {
  const der = Uint8Array.from(atob(pem.replace(/\\n/g, '\n').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data)));
}
route('GET', '/api/memberships/:id/wallet/google', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  if (!walletReady(env)) throw new HttpError(503, 'Google Wallet is not set up yet.');
  const m = await env.DB.prepare(`select m.id, m.member_code, m.stamps, c.id as cafe_id, c.name, c.brand, c.stamp_goal, c.reward_text
    from memberships m join cafes c on c.id = m.cafe_id where m.id = ? and m.user_id = ?`).bind(p.id, u.id).first<{ id: string; member_code: string; stamps: number; cafe_id: string; name: string; brand: string; stamp_goal: number; reward_text: string }>();
  if (!m) throw new HttpError(404, 'Card not found.');
  const origin = new URL(req.url).origin, issuer = env.GOOGLE_WALLET_ISSUER_ID!;
  const classId = `${issuer}.cafe_${m.cafe_id.replace(/[^\w.-]/g, '_')}`;
  const bg = (JSON.parse(m.brand) as { bg: string }).bg;
  const claims = {
    iss: env.GOOGLE_WALLET_SA_EMAIL, aud: 'google', typ: 'savetowallet', origins: [origin], iat: Math.floor(Date.now() / 1000),
    payload: {
      loyaltyClasses: [{ id: classId, issuerName: 'Niro', programName: m.name, reviewStatus: 'UNDER_REVIEW', hexBackgroundColor: bg,
        programLogo: { sourceUri: { uri: `${origin}/icons/icon-512.png` }, contentDescription: { defaultValue: { language: 'en-US', value: 'Niro' } } } }],
      loyaltyObjects: [{ id: `${issuer}.m_${m.id.replace(/[^\w.-]/g, '_')}`, classId, state: 'ACTIVE', accountId: m.member_code, accountName: u.name,
        barcode: { type: 'QR_CODE', value: m.member_code, alternateText: m.member_code },
        loyaltyPoints: { label: 'Stamps', balance: { string: `${m.stamps} / ${m.stamp_goal}` } },
        textModulesData: [{ header: 'Reward', body: m.reward_text, id: 'reward' }] }],
    },
  };
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), body = b64u(JSON.stringify(claims));
  const sig = await signRs256(env.GOOGLE_WALLET_PRIVATE_KEY!, `${head}.${body}`);
  return json({ url: `https://pay.google.com/gp/v/save/${head}.${body}.${sig}` });
});

route('GET', '/api/memberships/:id/history', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  const m = await env.DB.prepare(`select id, joined_at from memberships where id = ? and user_id = ?`).bind(p.id, u.id).first<{ id: string; joined_at: string }>();
  if (!m) throw new HttpError(404, 'Card not found.');
  const r = await env.DB.prepare(`select kind, qty, created_at from stamp_events where membership_id = ? order by id desc limit 30`).bind(m.id).all();
  return json({ joined_at: m.joined_at, events: r.results });
});

// Everything stored about the signed-in person, as one JSON file.
route('GET', '/api/me/export', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const q = async (sql: string) => (await env.DB.prepare(sql).bind(u.id).all()).results;
  const data = {
    exported_at: now(),
    profile: { id: u.id, phone: u.phone, name: u.name, email: u.email, birthday: u.birthday, food_preference: u.diet, usual_order: u.fav_order, settings: JSON.parse(u.prefs), has_photo: !!u.photo_key },
    special_dates: await q(`select label, on_date from special_dates where user_id = ?`),
    loyalty_cards: await q(`select c.name as cafe, m.member_code, m.stamps, m.rewards_redeemed, m.offers_opt_in, m.joined_at from memberships m join cafes c on c.id = m.cafe_id where m.user_id = ?`),
    stamp_history: await q(`select c.name as cafe, e.kind, e.qty, e.created_at from stamp_events e join memberships m on m.id = e.membership_id join cafes c on c.id = e.cafe_id where m.user_id = ? order by e.id`),
    saved_offers: await q(`select o.title, c.name as cafe from saved_offers s join offers o on o.id = s.offer_id join cafes c on c.id = o.cafe_id where s.user_id = ?`),
    nearby_alerts: await q(`select c.name as cafe, g.sent_at from geo_alerts g join cafes c on c.id = g.cafe_id where g.user_id = ? order by g.id`),
    works_at: await q(`select c.name as cafe, s.role from staff s join cafes c on c.id = s.cafe_id where s.user_id = ?`),
    support_messages: await q(`select message, contact, created_at from support_messages where user_id = ?`),
    push_devices: ((await env.DB.prepare(`select count(*) as n from device_tokens where user_id = ?`).bind(u.id).first<{ n: number }>())?.n ?? 0),
  };
  return json(data, 200, { 'content-disposition': 'attachment; filename="niro-my-data.json"' });
});

// Contact support: stored for you to read in the D1 console (table support_messages). Works signed in or out.
route('POST', '/api/support', async ({ req, env }) => {
  const b = await body(req);
  const message = str(b.message, 1000, 'Message', true)!;
  if (message.length < 5) throw new HttpError(400, 'Write a little more so we can help.');
  const contact = str(b.contact, 120, 'Contact');
  let userId: string | null = null;
  try { userId = (await requireUser(req, env)).id; } catch { /* not signed in */ }
  if (!userId && !contact) throw new HttpError(400, 'Add a phone number or email so we can reply.');
  const ipHash = await sha256('ip:' + (req.headers.get('cf-connecting-ip') ?? 'unknown'));
  const recent = await env.DB.prepare(`select count(*) as n from support_messages where ip_hash = ? and created_at > ?`).bind(ipHash, new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 5) throw new HttpError(429, 'Too many messages. Try again in an hour.');
  const id = uuid();
  await env.DB.prepare(`insert into support_messages (id, user_id, contact, message, ip_hash, created_at) values (?, ?, ?, ?, ?, ?)`).bind(id, userId, contact, message, ipHash, now()).run();
  return json({ ok: true, id }, 201);
});

// Area name for a point (OpenStreetMap Nominatim, looked up by our server so the phone sends no third-party request).
route('GET', '/api/geo/reverse', async ({ req, env, url }) => {
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'Send lat and lng.');
  const la = lat.toFixed(3), lo = lng.toFixed(3);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`https://cache.niro.invalid/reverse/${la}/${lo}`);
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const ipKey = 'geo:' + (req.headers.get('cf-connecting-ip') ?? 'unknown');
  const used = await env.DB.prepare(`select count(*) as n from otp_requests where phone = ? and created_at > ?`).bind(ipKey, new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>();
  if ((used?.n ?? 0) >= 120) throw new HttpError(429, 'Too many lookups. Try again later.');
  await env.DB.prepare(`insert into otp_requests (phone, created_at) values (?, ?)`).bind(ipKey, now()).run();
  let res: Response;
  try {
    res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${la}&lon=${lo}`,
      { headers: { 'user-agent': 'Niro/1.0 (+https://niro.cards)', 'accept-language': 'en' }, signal: AbortSignal.timeout(4000) });
  } catch { throw new HttpError(502, 'Could not look up your area.'); }
  if (!res.ok) throw new HttpError(502, 'Could not look up your area.');
  const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
  const locality = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || a.hamlet || '';
  const city = a.city || a.town || a.municipality || a.county || a.state_district || a.state || '';
  const out = json({ locality, city, label: [locality, city].filter(Boolean).join(', ') }, 200, { 'cache-control': 'public, max-age=86400' });
  if (cache) await cache.put(key, out.clone());
  return out;
});

// --- nearby alerts: the phone asks before showing a popup. Max 2 a day in total (India time). ---
route('POST', '/api/geo-alerts', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  const cafeId = str(b.cafe_id, 64, 'cafe_id', true)!;
  if (JSON.parse(u.prefs).geo === false) return json({ allowed: false, reason: 'off' });
  const cafe = await env.DB.prepare(`select id from cafes where id = ? and is_active = 1`).bind(cafeId).first();
  if (!cafe) throw new HttpError(404, 'Cafe not found.');
  // Check the daily limit and record the alert in one statement, so two quick requests cannot both pass.
  const start = istDayStart();
  const ins = await env.DB.prepare(`insert into geo_alerts (user_id, cafe_id, sent_at)
      select ?1, ?2, ?3 where (select count(*) from geo_alerts where user_id = ?1 and sent_at >= ?4) < ?5`)
    .bind(u.id, cafeId, now(), start, GEO_DAILY_CAP).run();
  const used = await env.DB.prepare(`select count(*) as n from geo_alerts where user_id = ? and sent_at >= ?`).bind(u.id, start).first<{ n: number }>();
  if (!ins.meta.changes) return json({ allowed: false, reason: 'daily_limit', used: used?.n });
  return json({ allowed: true, used: used?.n ?? 1, cap: GEO_DAILY_CAP });
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
const cafeName = async (env: Env, id: string) => (await env.DB.prepare(`select name from cafes where id = ?`).bind(id).first<{ name: string }>())?.name ?? '';
async function cardByCode(env: Env, raw: unknown) {
  const code = String(raw ?? '').trim().toUpperCase();
  const m = await env.DB.prepare(`select m.id, m.cafe_id, m.user_id, m.stamps, c.stamp_goal from memberships m join cafes c on c.id = m.cafe_id where m.member_code = ?`)
    .bind(code).first<{ id: string; cafe_id: string; user_id: string; stamps: number; stamp_goal: number }>();
  if (!m) throw new HttpError(404, 'Card not found.');
  return m;
}

// --- live connection: the customer's phone hears about scans and stamps within a second (server-sent events) ---
async function pushLive(env: Env, userId: string, kind: 'scan' | 'stamp' | 'redeem', cafeName: string, qty = 0) {
  await env.DB.prepare(`insert into live_events (user_id, kind, cafe_name, qty, created_at) values (?, ?, ?, ?, ?)`).bind(userId, kind, cafeName, qty, now()).run();
  await env.DB.prepare(`delete from live_events where created_at < ?`).bind(new Date(Date.now() - 86400_000).toISOString()).run();
}
route('GET', '/api/live', async ({ req, env }) => {
  const u = await requireUser(req, env);
  let last = (await env.DB.prepare(`select coalesce(max(id), 0) as n from live_events where user_id = ?`).bind(u.id).first<{ n: number }>())?.n ?? 0;
  const enc = new TextEncoder(); let closed = false;
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (t: string) => { if (!closed) try { ctrl.enqueue(enc.encode(t)); } catch { closed = true; } };
      send('retry: 1500\n\n: connected\n\n');
      const end = Date.now() + 28_000;
      while (!closed && Date.now() < end) {
        const r = await env.DB.prepare(`select id, kind, cafe_name, qty from live_events where user_id = ? and id > ? order by id`).bind(u.id, last).all<{ id: number; kind: string; cafe_name: string; qty: number }>();
        for (const e of r.results) { last = e.id; send(`event: live\ndata: ${JSON.stringify(e)}\n\n`); }
        if (!r.results.length) send(': ping\n\n');
        await new Promise((res) => setTimeout(res, 1000));
      }
      if (!closed) try { ctrl.close(); } catch { /* already closed */ }
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
});

route('POST', '/api/staff/stamp', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  const m = await cardByCode(env, b.code);
  await requireStaffForCard(env, u.id, m);
  const room = m.stamp_goal - m.stamps;
  if (room <= 0) throw new HttpError(409, 'The card is full. Give the reward first.');
  const qty = Math.min(Math.max(1, Math.min(Number(b.qty) || 1, 10)), room); // never count more stamps than were really added
  await env.DB.batch([
    env.DB.prepare(`update memberships set stamps = min(stamps + ?, ?) where id = ?`).bind(qty, m.stamp_goal, m.id),
    env.DB.prepare(`insert into stamp_events (membership_id, cafe_id, staff_user_id, kind, qty, created_at) values (?, ?, ?, 'stamp', ?, ?)`).bind(m.id, m.cafe_id, u.id, qty, now()),
  ]);
  const fresh = await env.DB.prepare(`select stamps, rewards_redeemed from memberships where id = ?`).bind(m.id).first<{ stamps: number; rewards_redeemed: number }>();
  await pushLive(env, m.user_id, 'stamp', await cafeName(env, m.cafe_id), qty);
  return json({ ...fresh, stamp_goal: m.stamp_goal, reward_ready: (fresh?.stamps ?? 0) >= m.stamp_goal });
});

route('POST', '/api/staff/redeem', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  const m = await cardByCode(env, b.code);
  await requireStaffForCard(env, u.id, m);
  const r = await env.DB.prepare(`update memberships set stamps = stamps - ?, rewards_redeemed = rewards_redeemed + 1 where id = ? and stamps >= ?`).bind(m.stamp_goal, m.id, m.stamp_goal).run();
  if (!r.meta.changes) throw new HttpError(409, 'The card is not full yet.');
  await env.DB.prepare(`insert into stamp_events (membership_id, cafe_id, staff_user_id, kind, qty, created_at) values (?, ?, ?, 'redeem', 1, ?)`).bind(m.id, m.cafe_id, u.id, now()).run();
  const fresh = await env.DB.prepare(`select stamps, rewards_redeemed from memberships where id = ?`).bind(m.id).first();
  await pushLive(env, m.user_id, 'redeem', await cafeName(env, m.cafe_id));
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
const DEFAULT_BRAND = '{"bg":"#0b0b0b","ink":"#fafafa","acc":"#d9a066","pattern":"dots"}';
function cafeInsert(env: Env, b: Record<string, unknown>, ownerId: string | null, active: 0 | 1) {
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, 'lat and lng are required.');
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'lat and lng are not valid.');
  const kind = b.kind === 'restaurant' ? 'restaurant' : 'cafe';
  const id = uuid();
  const stmt = env.DB.prepare(`insert into cafes (id, owner_id, name, kind, area, city, lat, lng, opens, closes, brand, stamp_goal, reward_text, is_active)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, ownerId, str(b.name, 80, 'Name', true), kind, str(b.area, 60, 'Area'), str(b.city, 60, 'City') ?? 'Mysuru', lat, lng,
      hhmm(b.opens, 'opens'), hhmm(b.closes, 'closes'), b.brand ? cleanBrand(b.brand) : DEFAULT_BRAND,
      Math.max(1, Math.min(Number(b.stamp_goal) || 8, 20)), str(b.reward_text, 60, 'reward_text') ?? 'Free filter coffee', active);
  return { id, stmt };
}

route('POST', '/api/cafes', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const b = await body(req);
  const mine = await env.DB.prepare(`select count(*) as n from cafes where owner_id = ?`).bind(u.id).first<{ n: number }>();
  if ((mine?.n ?? 0) >= 3) throw new HttpError(429, 'You can add up to 3 cafes. Contact us for more.');
  // A new cafe stays hidden (is_active = 0) until you approve it on the admin page.
  const { id, stmt } = cafeInsert(env, b, u.id, 0);
  await env.DB.batch([stmt, env.DB.prepare(`insert into staff (id, cafe_id, user_id, role) values (?, ?, ?, 'owner')`).bind(uuid(), id, u.id)]);
  return json({ id, pending_approval: true }, 201);
});

/** Fields of a cafe that can be edited. Admins may also move it, rename its city and switch it on or off. */
function cafeFields(b: Record<string, unknown>, admin: boolean) {
  const sets: string[] = []; const vals: unknown[] = [];
  if ('name' in b) { sets.push('name = ?'); vals.push(str(b.name, 80, 'Name', true)); }
  if ('area' in b) { sets.push('area = ?'); vals.push(str(b.area, 60, 'Area')); }
  if ('opens' in b) { sets.push('opens = ?'); vals.push(hhmm(b.opens, 'opens')); }
  if ('closes' in b) { sets.push('closes = ?'); vals.push(hhmm(b.closes, 'closes')); }
  if ('reward_text' in b) { sets.push('reward_text = ?'); vals.push(str(b.reward_text, 60, 'reward_text', true)); }
  if ('stamp_goal' in b) { sets.push('stamp_goal = ?'); vals.push(Math.max(1, Math.min(Number(b.stamp_goal) || 8, 20))); }
  if ('brand' in b) { sets.push('brand = ?'); vals.push(cleanBrand(b.brand)); }
  if (admin) {
    if ('city' in b) { sets.push('city = ?'); vals.push(str(b.city, 60, 'City', true)); }
    if ('kind' in b) { sets.push('kind = ?'); vals.push(b.kind === 'restaurant' ? 'restaurant' : 'cafe'); }
    if ('lat' in b || 'lng' in b) {
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'lat and lng are not valid.');
      sets.push('lat = ?', 'lng = ?'); vals.push(lat, lng);
    }
    if ('is_active' in b) { sets.push('is_active = ?'); vals.push(b.is_active ? 1 : 0); }
  }
  return { sets, vals };
}

route('PATCH', '/api/cafes/:id', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await requireManager(env, u.id, p.id);
  const { sets, vals } = cafeFields(await body(req), false);
  if (sets.length) await env.DB.prepare(`update cafes set ${sets.join(', ')} where id = ?`).bind(...vals, p.id).run();
  return json({ ok: true });
});

// --- admin: add and manage the real cafes (people listed in ADMIN_PHONES) ---
route('GET', '/api/admin/cafes', async ({ req, env }) => {
  await requireAdmin(req, env);
  const r = await env.DB.prepare(`select id, name, kind, area, city, lat, lng, opens, closes, stamp_goal, reward_text, brand, is_active, owner_id, created_at from cafes order by created_at desc limit 300`).all<CafeRow & { owner_id: string | null }>();
  const members = await env.DB.prepare(`select cafe_id, count(*) as n from memberships group by cafe_id`).all<{ cafe_id: string; n: number }>();
  const n = new Map(members.results.map((m) => [m.cafe_id, m.n]));
  return json({ cafes: r.results.map((c) => ({ ...c, brand: JSON.parse(c.brand), members: n.get(c.id) ?? 0 })) });
});

route('POST', '/api/admin/cafes', async ({ req, env }) => {
  await requireAdmin(req, env);
  const b = await body(req);
  const { id, stmt } = cafeInsert(env, b, null, 1);
  const stmts = [stmt];
  const offer = str(b.offer_title, 100, 'Offer');
  if (offer) stmts.push(env.DB.prepare(`insert into offers (id, cafe_id, title, ends_at) values (?, ?, ?, ?)`).bind(uuid(), id, offer, endsAt(b.offer_ends_at)));
  await env.DB.batch(stmts);
  return json({ id }, 201);
});

route('PATCH', '/api/admin/cafes/:id', async ({ req, env, p }) => {
  await requireAdmin(req, env);
  const { sets, vals } = cafeFields(await body(req), true);
  if (!sets.length) throw new HttpError(400, 'Nothing to change.');
  const r = await env.DB.prepare(`update cafes set ${sets.join(', ')} where id = ?`).bind(...vals, p.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Cafe not found.');
  return json({ ok: true });
});

route('POST', '/api/admin/cafes/:id/offers', async ({ req, env, p }) => {
  await requireAdmin(req, env);
  const b = await body(req);
  const c = await env.DB.prepare(`select id from cafes where id = ?`).bind(p.id).first();
  if (!c) throw new HttpError(404, 'Cafe not found.');
  const id = uuid();
  await env.DB.prepare(`insert into offers (id, cafe_id, title, ends_at) values (?, ?, ?, ?)`).bind(id, p.id, str(b.title, 100, 'Title', true), endsAt(b.ends_at)).run();
  return json({ id }, 201);
});

async function addStaff(env: Env, cafeId: string, b: Record<string, unknown>, actorIsOwner: boolean) {
  const phone = normalizePhone(b.phone);
  const role = b.role === 'manager' ? 'manager' : 'staff';
  if (role === 'manager' && !actorIsOwner) throw new HttpError(403, 'Only the owner can add a manager.');
  await env.DB.prepare(`insert into users (id, phone) values (?, ?) on conflict(phone) do nothing`).bind(uuid(), phone).run();
  const target = await env.DB.prepare(`select id from users where phone = ?`).bind(phone).first<{ id: string }>();
  await env.DB.prepare(`insert into staff (id, cafe_id, user_id, role, hourly_rate) values (?, ?, ?, ?, ?)
                        on conflict(cafe_id, user_id) do update set role = excluded.role, hourly_rate = excluded.hourly_rate, is_active = 1
                        where staff.role != 'owner'`)
    .bind(uuid(), cafeId, target!.id, role, Math.min(100000, Math.max(0, Number(b.hourly_rate) || 0))).run();
}
route('POST', '/api/admin/cafes/:id/staff', async ({ req, env, p }) => {
  await requireAdmin(req, env);
  const c = await env.DB.prepare(`select id from cafes where id = ?`).bind(p.id).first();
  if (!c) throw new HttpError(404, 'Cafe not found.');
  await addStaff(env, p.id, await body(req), true);
  return json({ ok: true }, 201);
});

route('POST', '/api/cafes/:id/photos', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await requireManager(env, u.id, p.id);
  const c = await env.DB.prepare(`select photo_keys from cafes where id = ?`).bind(p.id).first<{ photo_keys: string }>();
  const keys: string[] = JSON.parse(c?.photo_keys ?? '[]');
  if (keys.length >= 8) throw new HttpError(400, 'A cafe can have up to 8 photos.');
  const img = await readImage(req);
  const key = `cafe-media/${p.id}/${Date.now()}.${img.ext}`;
  await media(env).put(key, img.bytes, { httpMetadata: { contentType: img.type } });
  keys.push(key);
  await env.DB.prepare(`update cafes set photo_keys = ? where id = ?`).bind(JSON.stringify(keys), p.id).run();
  return json({ url: `/api/media/${key}` }, 201);
});

route('POST', '/api/cafes/:id/offers', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await requireManager(env, u.id, p.id);
  const b = await body(req);
  const id = uuid();
  await env.DB.prepare(`insert into offers (id, cafe_id, title, ends_at) values (?, ?, ?, ?)`).bind(id, p.id, str(b.title, 100, 'Title', true), endsAt(b.ends_at)).run();
  return json({ id }, 201);
});

route('POST', '/api/cafes/:id/staff', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  const me = await requireManager(env, u.id, p.id);
  await addStaff(env, p.id, await body(req), me.role === 'owner');
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

// --- partner app (partner.niro.cards): everything an owner or manager needs for their own cafes ---
route('GET', '/api/partner/cafes', async ({ req, env }) => {
  const u = await requireUser(req, env);
  const mine = await env.DB.prepare(
    `select c.id, c.name, c.kind, c.area, c.city, c.lat, c.lng, c.opens, c.closes, c.stamp_goal, c.reward_text, c.brand, c.is_active, s.role
     from staff s join cafes c on c.id = s.cafe_id where s.user_id = ? and s.is_active = 1 and s.role in ('owner','manager') order by c.created_at`).bind(u.id).all<CafeRow & { role: string }>();
  const out = [];
  for (const c of mine.results) {
    const st = await env.DB.prepare(
      `select (select count(*) from memberships where cafe_id = ?1) as members,
              (select coalesce(sum(qty), 0) from stamp_events where cafe_id = ?1 and kind = 'stamp' and created_at >= ?2) as stamps_today,
              (select coalesce(sum(qty), 0) from stamp_events where cafe_id = ?1 and kind = 'stamp' and created_at >= ?3) as stamps_week,
              (select count(*) from stamp_events where cafe_id = ?1 and kind = 'redeem') as rewards_redeemed`).bind(c.id, istDayStart(), new Date(Date.now() - 7 * 86400_000).toISOString()).first();
    const offers = await env.DB.prepare(`select id, title, ends_at from offers where cafe_id = ? and is_active = 1 order by created_at desc`).bind(c.id).all();
    const staff = await env.DB.prepare(
      `select s.id, u.name, u.phone, s.role, s.hourly_rate, (select clock_in from shifts where staff_id = s.id and clock_out is null) as clocked_in_since
       from staff s join users u on u.id = s.user_id where s.cafe_id = ? and s.is_active = 1 order by s.role, u.name`).bind(c.id).all();
    out.push({ ...c, brand: JSON.parse(c.brand), stats: st, offers: offers.results, staff: staff.results });
  }
  return json({ cafes: out, me: { name: u.name, phone: u.phone } });
});

route('DELETE', '/api/cafes/:id/offers/:oid', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await requireManager(env, u.id, p.id);
  const r = await env.DB.prepare(`update offers set is_active = 0 where id = ? and cafe_id = ? and is_active = 1`).bind(p.oid, p.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Offer not found.');
  return json({ ok: true });
});

route('DELETE', '/api/cafes/:id/staff/:sid', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  const me = await requireManager(env, u.id, p.id);
  const t = await env.DB.prepare(`select id, role from staff where id = ? and cafe_id = ? and is_active = 1`).bind(p.sid, p.id).first<{ id: string; role: string }>();
  if (!t) throw new HttpError(404, 'Staff member not found.');
  if (t.role === 'owner') throw new HttpError(403, 'The owner cannot be removed.');
  if (t.role === 'manager' && me.role !== 'owner') throw new HttpError(403, 'Only the owner can remove a manager.');
  await env.DB.batch([
    env.DB.prepare(`update shifts set clock_out = ? where staff_id = ? and clock_out is null`).bind(now(), t.id),
    env.DB.prepare(`update staff set is_active = 0 where id = ?`).bind(t.id),
  ]);
  return json({ ok: true });
});

// --- workforce app (workforce.niro.cards): look up a card before stamping, and see today's activity ---
route('GET', '/api/staff/card', async ({ req, env, url }) => {
  const u = await requireUser(req, env);
  const m = await cardByCode(env, url.searchParams.get('code'));
  await requireStaffForCard(env, u.id, m);
  const r = await env.DB.prepare(
    `select u.name, m.stamps, m.rewards_redeemed, c.name as cafe, c.stamp_goal, c.reward_text from memberships m join users u on u.id = m.user_id join cafes c on c.id = m.cafe_id where m.id = ?`)
    .bind(m.id).first<{ name: string; stamps: number; rewards_redeemed: number; cafe: string; stamp_goal: number; reward_text: string }>();
  await pushLive(env, m.user_id, 'scan', r!.cafe);
  return json({ ...r!, name: r!.name.split(/\s+/)[0] });
});

route('GET', '/api/staff/today', async ({ req, env, url }) => {
  const u = await requireUser(req, env);
  const cafeId = str(url.searchParams.get('cafe_id'), 64, 'cafe_id', true)!;
  await requireStaff(env, u.id, cafeId);
  const r = await env.DB.prepare(
    `select e.kind, e.qty, e.created_at, cu.name as customer from stamp_events e join memberships m on m.id = e.membership_id join users cu on cu.id = m.user_id
     where e.cafe_id = ? and e.staff_user_id = ? and e.created_at >= ? order by e.id desc limit 30`).bind(cafeId, u.id, istDayStart()).all<{ kind: string; qty: number; created_at: string; customer: string }>();
  const sum = r.results.reduce((a, x) => a + (x.kind === 'stamp' ? x.qty : 0), 0);
  return json({ stamps: sum, events: r.results.map((x) => ({ ...x, customer: x.customer.split(/\s+/)[0] })) });
});

// --- admin app (admin.niro.cards): whole-platform view ---
// partner: the people who joined my cafe. Only the first name part, the last 4 digits of the number, and card activity.
route('GET', '/api/cafes/:id/customers', async ({ req, env, p }) => {
  const u = await requireUser(req, env);
  await requireManager(env, u.id, p.id);
  const r = await env.DB.prepare(
    `select cu.name, substr(cu.phone, -4) as last4, m.stamps, m.rewards_redeemed, m.joined_at,
       (select max(created_at) from stamp_events where membership_id = m.id) as last_visit
     from memberships m join users cu on cu.id = m.user_id where m.cafe_id = ? order by coalesce(last_visit, m.joined_at) desc limit 500`).bind(p.id).all();
  return json({ customers: r.results });
});

// admin: every user and what they are (customer, client = owner or manager, staff)
route('GET', '/api/admin/users', async ({ req, env }) => {
  await requireAdmin(req, env);
  const r = await env.DB.prepare(
    `select u.id, u.name, u.phone, u.email, u.created_at,
       (select count(*) from memberships where user_id = u.id) as cards,
       (select group_concat(c.name || ' (' || s.role || ')', ', ') from staff s join cafes c on c.id = s.cafe_id where s.user_id = u.id and s.is_active = 1) as jobs,
       (select count(*) from staff where user_id = u.id and is_active = 1 and role in ('owner','manager')) as is_client,
       (select count(*) from staff where user_id = u.id and is_active = 1 and role = 'staff') as is_staff
     from users u order by u.created_at desc limit 1000`).all();
  return json({ users: r.results });
});

route('GET', '/api/admin/staff', async ({ req, env }) => {
  await requireAdmin(req, env);
  const r = await env.DB.prepare(
    `select s.id, u.name, u.phone, s.role, s.hourly_rate, c.name as cafe, (select clock_in from shifts where staff_id = s.id and clock_out is null) as clocked_in_since
     from staff s join users u on u.id = s.user_id join cafes c on c.id = s.cafe_id where s.is_active = 1 order by c.name, s.role`).all();
  return json({ staff: r.results });
});

route('GET', '/api/admin/overview', async ({ req, env }) => {
  await requireAdmin(req, env);
  const r = await env.DB.prepare(
    `select (select count(*) from users) as users,
            (select count(distinct user_id) from staff where is_active = 1 and role in ('owner','manager')) as clients,
            (select count(distinct user_id) from staff where is_active = 1 and role = 'staff') as staff,
            (select count(distinct user_id) from memberships) as customers,
            (select count(*) from staff s where s.is_active = 1 and exists (select 1 from shifts where staff_id = s.id and clock_out is null)) as working_now,
            (select count(*) from cafes where is_active = 1) as cafes_live,
            (select count(*) from cafes where is_active = 0) as cafes_pending,
            (select count(*) from memberships) as cards,
            (select coalesce(sum(qty), 0) from stamp_events where kind = 'stamp' and created_at >= ?1) as stamps_today,
            (select count(*) from stamp_events where kind = 'redeem') as rewards_redeemed,
            (select count(*) from support_messages where status = 'open') as support_open`).bind(istDayStart()).first();
  return json(r);
});

route('GET', '/api/admin/support', async ({ req, env, url }) => {
  await requireAdmin(req, env);
  const status = url.searchParams.get('status') === 'closed' ? 'closed' : 'open';
  const r = await env.DB.prepare(`select id, contact, message, status, created_at from support_messages where status = ? order by created_at desc limit 100`).bind(status).all();
  return json({ messages: r.results });
});

route('PATCH', '/api/admin/support/:id', async ({ req, env, p }) => {
  await requireAdmin(req, env);
  const b = await body(req);
  const r = await env.DB.prepare(`update support_messages set status = ? where id = ?`).bind(b.status === 'open' ? 'open' : 'closed', p.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Message not found.');
  return json({ ok: true });
});

route('DELETE', '/api/admin/cafes/:id', async ({ req, env, p }) => {
  await requireAdmin(req, env);
  const r = await env.DB.prepare(`delete from cafes where id = ? and is_active = 0`).bind(p.id).run();
  if (!r.meta.changes) throw new HttpError(409, 'Only a hidden cafe can be deleted. Hide it first.');
  return json({ ok: true });
});

// ---------- billing: invoices from Niro to partner businesses (admins only) ----------
// Totals are always worked out here from the items; whatever totals a client sends are ignored.
const PLAN_KINDS = ['monthly', 'yearly'];
const INVOICE_STYLES = ['paper', 'block', 'term'];
const DEFAULT_BILLING = {
  from: { name: 'Niro by Outpulse LLP', line: 'Loyalty cards & marketing', contact: '', gstin: '', address: '' },
  plans: { monthly: 199, yearly: 1999 },
  tax_name: 'GST', tax_rate: 18, terms_days: 7,
  note: 'Pay by UPI or bank transfer within 7 days. Thank you for growing with Niro.',
};
type BillingSettings = typeof DEFAULT_BILLING;
type InvoiceItem = { name: string; qty: number; price: number; plan?: string };
type InvoiceRow = {
  id: string; seq: number; number: string; cafe_id: string | null; seller: string; bill_to: string; items: string; tax_name: string; tax_rate: number;
  subtotal: number; tax: number; total: number; issued_on: string; due_on: string; period_start: string | null; period_end: string | null;
  status: string; paid_on: string | null; note: string | null; style: string; created_at: string; cafe_name?: string | null;
};

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
function addDaysTo(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function addMonthsTo(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z'); const dd = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dd, last)); return d.toISOString().slice(0, 10);
}
function day(v: unknown, field: string, fallback: string | null): string | null {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) throw new HttpError(400, `${field} must be YYYY-MM-DD.`);
  return v;
}
function money2(v: unknown, field: string, max = 10_000_000): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) throw new HttpError(400, `${field} must be a number from 0 to ${max}.`);
  return round2(n);
}
function taxRate(v: unknown): number {
  const n = money2(v, 'Tax rate', 100);
  return n;
}
function cleanItems(v: unknown): InvoiceItem[] {
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'Add at least one item.');
  if (v.length > 30) throw new HttpError(400, 'An invoice can have up to 30 items.');
  return v.map((raw, i) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new HttpError(400, `Item ${i + 1}: quantity must be a whole number from 1 to 999.`);
    const out: InvoiceItem = { name: str(it.name, 80, `Item ${i + 1} name`, true)!, qty, price: money2(it.price, `Item ${i + 1} price`) };
    if (typeof it.plan === 'string' && PLAN_KINDS.includes(it.plan)) out.plan = it.plan;
    return out;
  });
}
function cleanParty(v: unknown, field: string, requireName: boolean) {
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  return {
    name: str(o.name, 80, `${field} name`, requireName) ?? '',
    line: str(o.line, 120, `${field} details`) ?? '',
    contact: str(o.contact, 80, `${field} contact`) ?? '',
    gstin: (str(o.gstin, 15, 'GSTIN') ?? '').toUpperCase(),
    ...(field === 'From' ? { address: str(o.address, 200, 'Address') ?? '' } : {}),
  };
}
function totalsOf(items: InvoiceItem[], rate: number) {
  const subtotal = round2(items.reduce((a, it) => a + it.qty * it.price, 0));
  const tax = round2(subtotal * rate / 100);
  return { subtotal, tax, total: round2(subtotal + tax) };
}
async function billingSettings(env: Env): Promise<BillingSettings> {
  const r = await env.DB.prepare(`select data from billing_settings where id = 1`).first<{ data: string }>();
  if (!r) return structuredClone(DEFAULT_BILLING);
  const s = JSON.parse(r.data);
  return { ...DEFAULT_BILLING, ...s, from: { ...DEFAULT_BILLING.from, ...s.from }, plans: { ...DEFAULT_BILLING.plans, ...s.plans } };
}
function invoiceOut(r: InvoiceRow) {
  const today = istToday();
  const { seller, ...rest } = r;
  return { ...rest, from: JSON.parse(seller || '{}'), bill_to: JSON.parse(r.bill_to), items: JSON.parse(r.items), overdue: r.status === 'unpaid' && r.due_on < today };
}
async function invoiceById(env: Env, id: string) {
  const r = await env.DB.prepare(`select i.*, c.name as cafe_name from invoices i left join cafes c on c.id = i.cafe_id where i.id = ?`).bind(id).first<InvoiceRow>();
  if (!r) throw new HttpError(404, 'Invoice not found.');
  return invoiceOut(r);
}

route('GET', '/api/admin/billing', async ({ req, env }) => {
  await requireAdmin(req, env);
  const today = istToday();
  const [settings, list, sum] = await Promise.all([
    billingSettings(env),
    env.DB.prepare(`select i.*, c.name as cafe_name from invoices i left join cafes c on c.id = i.cafe_id order by i.seq desc limit 300`).all<InvoiceRow>(),
    env.DB.prepare(
      `select coalesce(sum(case when status = 'unpaid' then total end), 0) as outstanding,
              coalesce(sum(case when status = 'unpaid' and due_on < ?1 then total end), 0) as overdue,
              count(case when status = 'unpaid' and due_on < ?1 then 1 end) as overdue_count,
              coalesce(sum(case when status = 'paid' and paid_on >= ?2 then total end), 0) as collected_month,
              count(case when status != 'void' then 1 end) as invoices
       from invoices`).bind(today, today.slice(0, 8) + '01').first(),
  ]);
  return json({ settings, summary: sum, invoices: list.results.map(invoiceOut), today });
});

route('PUT', '/api/admin/billing/settings', async ({ req, env }) => {
  await requireAdmin(req, env);
  const b = await body(req);
  const plans = (b.plans && typeof b.plans === 'object' ? b.plans : {}) as Record<string, unknown>;
  const terms = Number(b.terms_days ?? DEFAULT_BILLING.terms_days);
  if (!Number.isInteger(terms) || terms < 0 || terms > 120) throw new HttpError(400, 'Payment terms must be 0 to 120 days.');
  const s: BillingSettings = {
    from: cleanParty(b.from, 'From', true) as BillingSettings['from'],
    plans: { monthly: money2(plans.monthly ?? DEFAULT_BILLING.plans.monthly, 'Monthly price', 1_000_000), yearly: money2(plans.yearly ?? DEFAULT_BILLING.plans.yearly, 'Yearly price', 1_000_000) },
    tax_name: str(b.tax_name, 20, 'Tax name') ?? 'GST',
    tax_rate: taxRate(b.tax_rate ?? DEFAULT_BILLING.tax_rate),
    terms_days: terms,
    note: str(b.note, 300, 'Note') ?? '',
  };
  await env.DB.prepare(`insert into billing_settings (id, data) values (1, ?) on conflict(id) do update set data = excluded.data`).bind(JSON.stringify(s)).run();
  return json({ settings: s });
});

route('POST', '/api/admin/invoices', async ({ req, env }) => {
  const admin = await requireAdmin(req, env);
  const b = await body(req);
  const s = await billingSettings(env);
  let cafeId: string | null = null;
  let billTo = cleanParty(b.bill_to, 'Bill to', false);
  if (b.cafe_id !== undefined && b.cafe_id !== null && b.cafe_id !== '') {
    const c = await env.DB.prepare(
      `select c.id, c.name, c.area, c.city, u.phone as owner_phone from cafes c left join users u on u.id = c.owner_id where c.id = ?`)
      .bind(String(b.cafe_id)).first<{ id: string; name: string; area: string | null; city: string; owner_phone: string | null }>();
    if (!c) throw new HttpError(404, 'Partner not found.');
    cafeId = c.id;
    billTo = {
      name: billTo.name || c.name,
      line: billTo.line || [c.area, c.city].filter(Boolean).join(', '),
      contact: billTo.contact || (c.owner_phone ?? ''),
      gstin: billTo.gstin,
    };
  }
  if (!billTo.name) throw new HttpError(400, 'Choose a partner or enter who the invoice is for.');
  const items = cleanItems(b.items);
  const rate = b.tax_rate === undefined ? s.tax_rate : taxRate(b.tax_rate);
  const t = totalsOf(items, rate);
  const issued = day(b.issued_on, 'Issue date', istToday())!;
  const due = day(b.due_on, 'Due date', addDaysTo(issued, s.terms_days))!;
  if (due < issued) throw new HttpError(400, 'The due date is before the issue date.');
  let pStart = day(b.period_start, 'Period start', null), pEnd = day(b.period_end, 'Period end', null);
  const plan = items.find((it) => it.plan)?.plan;
  if (plan && !pStart) pStart = issued;
  if (plan && pStart && !pEnd) pEnd = addDaysTo(addMonthsTo(pStart, plan === 'yearly' ? 12 * items.find((it) => it.plan)!.qty : items.find((it) => it.plan)!.qty), -1);
  const style = INVOICE_STYLES.includes(String(b.style)) ? String(b.style) : 'paper';
  const id = uuid();
  // The next number is picked inside the insert itself, so two invoices made at the same moment can't share one.
  await env.DB.prepare(
    `insert into invoices (id, seq, number, cafe_id, seller, bill_to, items, tax_name, tax_rate, subtotal, tax, total, issued_on, due_on, period_start, period_end, status, note, style, created_by, created_at)
     select ?1, coalesce(max(seq), 0) + 1, 'NIRO-' || printf('%04d', coalesce(max(seq), 0) + 1), ?2, ?18, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'unpaid', ?14, ?15, ?16, ?17 from invoices`)
    .bind(id, cafeId, JSON.stringify(billTo), JSON.stringify(items), s.tax_name, rate, t.subtotal, t.tax, t.total, issued, due, pStart, pEnd,
      str(b.note, 300, 'Note') ?? s.note, style, admin.id, now(), JSON.stringify(s.from)).run();
  return json(await invoiceById(env, id), 201);
});

route('GET', '/api/admin/invoices/:id', async ({ req, env, p }) => {
  await requireAdmin(req, env);
  return json(await invoiceById(env, p.id));
});

route('PATCH', '/api/admin/invoices/:id', async ({ req, env, p }) => {
  await requireAdmin(req, env);
  const b = await body(req);
  const cur = await invoiceById(env, p.id);
  const sets: string[] = [], vals: unknown[] = [];
  const contentKeys = ['items', 'bill_to', 'tax_rate', 'issued_on', 'due_on', 'period_start', 'period_end', 'note'];
  if (contentKeys.some((k) => k in b) && cur.status !== 'unpaid') throw new HttpError(409, 'Only unpaid invoices can be edited. Mark it unpaid first.');
  if ('items' in b || 'tax_rate' in b) {
    const items = 'items' in b ? cleanItems(b.items) : (cur.items as InvoiceItem[]);
    const rate = 'tax_rate' in b ? taxRate(b.tax_rate) : cur.tax_rate;
    const t = totalsOf(items, rate);
    sets.push('items = ?', 'tax_rate = ?', 'subtotal = ?', 'tax = ?', 'total = ?'); vals.push(JSON.stringify(items), rate, t.subtotal, t.tax, t.total);
  }
  if ('bill_to' in b) { const bt = cleanParty(b.bill_to, 'Bill to', true); sets.push('bill_to = ?'); vals.push(JSON.stringify(bt)); }
  const issued = 'issued_on' in b ? day(b.issued_on, 'Issue date', cur.issued_on)! : cur.issued_on;
  const due = 'due_on' in b ? day(b.due_on, 'Due date', cur.due_on)! : cur.due_on;
  if (due < issued) throw new HttpError(400, 'The due date is before the issue date.');
  if ('issued_on' in b) { sets.push('issued_on = ?'); vals.push(issued); }
  if ('due_on' in b) { sets.push('due_on = ?'); vals.push(due); }
  if ('period_start' in b) { sets.push('period_start = ?'); vals.push(day(b.period_start, 'Period start', null)); }
  if ('period_end' in b) { sets.push('period_end = ?'); vals.push(day(b.period_end, 'Period end', null)); }
  if ('note' in b) { sets.push('note = ?'); vals.push(str(b.note, 300, 'Note') ?? ''); }
  if ('style' in b) {
    if (!INVOICE_STYLES.includes(String(b.style))) throw new HttpError(400, 'Style must be paper, block or term.');
    sets.push('style = ?'); vals.push(String(b.style));
  }
  let planToSet: string | null = null;
  if ('status' in b) {
    const st = String(b.status);
    if (!['unpaid', 'paid', 'void'].includes(st)) throw new HttpError(400, 'Status must be unpaid, paid or void.');
    if (cur.status === 'void' && st !== 'void') throw new HttpError(409, 'A void invoice stays void. Make a new one instead.');
    sets.push('status = ?', 'paid_on = ?');
    vals.push(st, st === 'paid' ? (day(b.paid_on, 'Paid date', cur.paid_on ?? istToday())) : null);
    if (st === 'paid' && cur.cafe_id) planToSet = (cur.items as InvoiceItem[]).find((it) => it.plan)?.plan ?? null;
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to change.');
  const stmts = [env.DB.prepare(`update invoices set ${sets.join(', ')} where id = ?`).bind(...vals, p.id)];
  // Paying a plan invoice puts the partner on that plan.
  if (planToSet) stmts.push(env.DB.prepare(`update cafes set plan = ? where id = ?`).bind(planToSet, cur.cafe_id));
  await env.DB.batch(stmts);
  return json(await invoiceById(env, p.id));
});

// ---------- entry point ----------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        // Block cross-site writes: browsers send Origin on them, so a page on another site is turned away.
        const origin = req.headers.get('origin');
        if (origin && req.method !== 'GET' && req.method !== 'HEAD' && new URL(origin).host !== url.host) throw new HttpError(403, 'Cross-site request blocked.');
        await ensureDb(env);
      }
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
