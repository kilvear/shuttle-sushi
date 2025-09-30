create extension if not exists pgcrypto;
create table if not exists stock(
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  qty int not null default 0,
  location text not null default 'central'
);
