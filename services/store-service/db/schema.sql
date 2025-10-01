create extension if not exists pgcrypto;
create table if not exists local_orders(
  id uuid primary key default gen_random_uuid(),
  customer_id text,
  is_guest boolean default true,
  total_cents int not null,
  status text not null default 'PENDING',
  created_at timestamptz default now()
);
create table if not exists local_order_items(
  id uuid primary key default gen_random_uuid(),
  order_id uuid references local_orders(id) on delete cascade,
  sku text not null, qty int not null, price_cents int not null
);
create table if not exists local_stock(
  sku text primary key,
  qty int not null default 0,
  updated_at timestamptz default now()
);
-- Local catalog: source of truth for names and prices at the store
create table if not exists local_items(
  sku text primary key,
  name text not null,
  price_cents int not null,
  is_active boolean default true,
  updated_at timestamptz default now()
);
-- Seed initial stock for store-001 (idempotent)
insert into local_stock(sku, qty) values
  ('SUSHI-SALMON', 20),
  ('SUSHI-TUNA', 20),
  ('ROLL-CALIFORNIA', 15),
  ('ROLL-EEL', 12),
  ('ROLL-AVOCADO', 18),
  ('SOUP-MISO', 25),
  ('DRINK-GREENTEA', 30),
  ('DRINK-COKE', 36),
  ('DRINK-WATER', 40)
on conflict (sku) do nothing;
create table if not exists outbox(
  id bigserial primary key,
  topic text not null,
  payload jsonb not null,
  created_at timestamptz default now(),
  delivered boolean default false,
  last_error text
);
