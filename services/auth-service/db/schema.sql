create extension if not exists pgcrypto;
create table if not exists users(
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  role text not null check (role in ('staff','manager','customer')),
  created_at timestamptz default now()
);
