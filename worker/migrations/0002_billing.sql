-- Billing: invoices that Niro (Outpulse LLP) sends to partner businesses for their plan.
-- The API also creates these tables on first use (see ensureDb in src/index.ts), so existing databases pick them up without running this file.

create table if not exists invoices (
  id           text primary key,
  seq          integer not null unique,              -- 1, 2, 3 ... (never reused)
  number       text not null unique,                 -- NIRO-0001
  cafe_id      text references cafes(id) on delete set null,
  seller       text not null default '{}',              -- JSON: who it is from, as it was on the day it was made
  bill_to      text not null,                        -- JSON {name, line, contact, gstin}
  items        text not null,                        -- JSON [{name, qty, price, plan?}]
  tax_name     text not null default 'GST',
  tax_rate     real not null default 18,
  subtotal     real not null,
  tax          real not null,
  total        real not null,
  issued_on    text not null,                        -- YYYY-MM-DD (India time)
  due_on       text not null,
  period_start text,
  period_end   text,
  status       text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  paid_on      text,
  note         text,
  style        text not null default 'paper' check (style in ('paper', 'block', 'term')),
  created_by   text,
  created_at   text not null
);
create index if not exists invoices_cafe on invoices (cafe_id, issued_on);
create index if not exists invoices_status on invoices (status, due_on);

-- One row: who the invoices come from, plan prices, tax and payment terms.
create table if not exists billing_settings (
  id   integer primary key check (id = 1),
  data text not null
);
