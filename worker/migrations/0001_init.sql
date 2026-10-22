-- Cafe Loyalty on Cloudflare D1 (SQLite). Times are ISO-8601 UTC text. JSON is stored as text.
-- D1 has no row-level security, so every permission check lives in src/index.ts.

create table users (
  id          text primary key,
  phone       text not null unique,                 -- +91XXXXXXXXXX
  name        text not null default '',
  photo_key   text,                                 -- R2 key under avatars/
  birthday    text,                                 -- YYYY-MM-DD
  email       text,
  diet        text check (diet in ('Vegetarian','Eggetarian','Non-vegetarian','Vegan')),
  fav_order   text,
  prefs       text not null default '{"stamps":true,"offers":true,"treats":true,"geo":true}',
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table otp_codes (
  phone       text primary key,
  code_hash   text not null,
  name        text,
  attempts    integer not null default 0,
  expires_at  text not null
);

create table otp_requests (                         -- for rate limiting
  id          integer primary key autoincrement,
  phone       text not null,
  created_at  text not null
);
create index otp_requests_phone on otp_requests (phone, created_at);

create table sessions (
  token_hash  text primary key,                     -- sha-256 of the token; the token itself is never stored
  user_id     text not null references users(id) on delete cascade,
  expires_at  text not null,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index sessions_user on sessions (user_id);

create table special_dates (
  id        text primary key,
  user_id   text not null references users(id) on delete cascade,
  label     text not null default 'Special day',
  on_date   text not null
);
create index special_dates_user on special_dates (user_id);

create table cafes (
  id           text primary key,
  owner_id     text references users(id) on delete set null,
  name         text not null,
  slug         text unique,
  kind         text not null default 'cafe' check (kind in ('cafe','restaurant')),
  area         text,
  city         text not null default 'Mysuru',
  lat          real not null,
  lng          real not null,
  opens        text,                                -- HH:MM
  closes       text,
  brand        text not null default '{"bg":"#0b0b0b","ink":"#fafafa","acc":"#d9a066","pattern":"dots"}',
  photo_keys   text not null default '[]',          -- R2 keys under cafe-media/
  stamp_goal   integer not null default 8 check (stamp_goal > 0),
  reward_text  text not null default 'Free filter coffee',
  is_active    integer not null default 1,
  plan         text not null default 'trial',
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index cafes_active on cafes (is_active, lat, lng);

create table offers (
  id         text primary key,
  cafe_id    text not null references cafes(id) on delete cascade,
  title      text not null,
  ends_at    text,
  is_active  integer not null default 1,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index offers_cafe on offers (cafe_id, is_active);

create table saved_offers (
  user_id  text not null references users(id) on delete cascade,
  offer_id text not null references offers(id) on delete cascade,
  primary key (user_id, offer_id)
);

create table staff (
  id           text primary key,
  cafe_id      text not null references cafes(id) on delete cascade,
  user_id      text not null references users(id) on delete cascade,
  role         text not null default 'staff' check (role in ('owner','manager','staff')),
  hourly_rate  real not null default 0,
  is_active    integer not null default 1,
  unique (cafe_id, user_id)
);
create index staff_user on staff (user_id);

create table shifts (
  id         text primary key,
  staff_id   text not null references staff(id) on delete cascade,
  clock_in   text not null,
  clock_out  text,
  note       text
);
create index shifts_staff on shifts (staff_id, clock_in);

create table memberships (
  id                text primary key,
  user_id           text not null references users(id) on delete cascade,
  cafe_id           text not null references cafes(id) on delete cascade,
  member_code       text not null unique,           -- shown as the QR
  stamps            integer not null default 0 check (stamps >= 0),
  rewards_redeemed  integer not null default 0,
  offers_opt_in     integer not null default 1,
  joined_at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, cafe_id)
);
create index memberships_cafe on memberships (cafe_id);

create table stamp_events (
  id             integer primary key autoincrement,
  membership_id  text not null references memberships(id) on delete cascade,
  cafe_id        text not null references cafes(id) on delete cascade,
  staff_user_id  text references users(id),
  kind           text not null check (kind in ('stamp','redeem')),
  qty            integer not null default 1,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index stamp_events_cafe on stamp_events (cafe_id, created_at);
create index stamp_events_member on stamp_events (membership_id, created_at);

create table geo_alerts (
  id       integer primary key autoincrement,
  user_id  text not null references users(id) on delete cascade,
  cafe_id  text not null references cafes(id) on delete cascade,
  sent_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index geo_alerts_user on geo_alerts (user_id, sent_at);

create table device_tokens (
  token       text primary key,                     -- FCM token
  user_id     text not null references users(id) on delete cascade,
  platform    text not null check (platform in ('android','ios','web')),
  updated_at  text not null
);
create index device_tokens_user on device_tokens (user_id);

create table support_messages (
  id          text primary key,
  user_id     text,
  contact     text,
  message     text not null,
  ip_hash     text not null,
  status      text not null default 'open',
  created_at  text not null
);

create table live_events (
  id         integer primary key autoincrement,
  user_id    text not null,
  kind       text not null,
  cafe_name  text,
  qty        integer,
  created_at text not null
);
create index live_events_user on live_events (user_id, id);
