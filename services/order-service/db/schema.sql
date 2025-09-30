create extension if not exists pgcrypto;
create table if not exists orders(
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  customer_id text,
  total_cents int not null default 0,
  status text not null check (status in ('PENDING','PAID','CANCELLED')) default 'PENDING',
  created_at timestamptz default now()
);
create table if not exists order_items(
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  sku text not null,
  qty int not null,
  price_cents int not null
);
