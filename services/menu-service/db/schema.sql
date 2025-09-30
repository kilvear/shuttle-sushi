create extension if not exists pgcrypto;
create table if not exists menu_items(
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  name text not null,
  price_cents int not null,
  is_active boolean default true
);
insert into menu_items(sku,name,price_cents) values
  ('SUSHI-SALMON','Salmon Nigiri',250),
  ('SUSHI-TUNA','Tuna Nigiri',300),
  ('ROLL-CALIFORNIA','California Roll',450),
  ('ROLL-EEL','Unagi Roll',550),
  ('ROLL-AVOCADO','Avocado Roll',400),
  ('SOUP-MISO','Miso Soup',250),
  ('DRINK-GREENTEA','Green Tea',200),
  ('DRINK-COKE','Coca-Cola',200),
  ('DRINK-WATER','Bottled Water',150)
on conflict do nothing;
