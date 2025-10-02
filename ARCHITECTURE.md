# Shuttle Sushi — Architecture Overview

This document summarizes the final (code‑frozen) architecture, data flows, and runtime of the Shuttle Sushi capstone project.

## Principles
- Service‑per‑DB: Each backend service owns its tables in its own Postgres database; no cross‑DB joins.
- HTTP-only communication: Services interact via HTTP; frontends call services directly.
- Offline‑first store: The store has a local DB so sales continue if central services are down; central pulls to catch up.

## Services and Databases
- auth-service → auth-db (ports: service `3001`, DB `5433`)
  - JWT login/register/me; demo users seeded; shifts scheduling (`shifts`, `shift_assignments`).
- menu-service → menu-db (ports: service `3002`, DB `5434`)
  - Customer menu; reads names/prices from store `local_items`, availability from store `local_stock`; falls back to legacy `menu_items` if store DB unavailable.
- store-service → store-001-db (ports: service `3010`, DB `5441`)
  - Store‑level authority for selling: `local_items` (catalog), `local_stock`, `local_orders`, `outbox` (offline sync).
  - Endpoints for create/pay/cancel/refund orders and set/adjust stock; server‑side pricing from `local_items`.
- order-service → order-db (ports: service `3003`, DB `5435`)
  - Central orders. Pulls store outbox (`order.created`) to import; updates central `orders.status` to `CANCELLED` on store `order.cancelled` (idempotent by `store_order_id`).
- inventory-service → inventory-db (ports: service `3004`, DB `5436`)
  - Central inventory split:
    - `central_stock` (HQ inventory, includes `is_active`)
    - `store_stock_mirror` (per‑store mirror of live store stock)
    - `stock_movements` (ISSUE and other movements)
  - Periodically mirrors `store-001` `local_stock` into `store_stock_mirror`. Admin endpoints to create/set/adjust central stock and toggle active.

## Frontends (React, containerized)
- POS Web (staff/manager) → http://localhost:8081
  - Role‑gated sales, refunds (manager), stock set/adjust, SKU create/edit (manager), “My Shifts (14 days)”.
- Customer Web → http://localhost:8082
  - Mobile‑oriented menu/cart/checkout with mock pay success/failure; optional auth.
- Admin Dashboard → http://localhost:8083
  - Status panel, central orders and reports (daily/weekly/monthly, PAID‑only), inventory (central/store/compare/movements), users admin; login gating (staff read‑only, manager full).

## Data Flows
- Orders (offline‑first)
  1) POS/Customer call `store-service` → commit to `store-001-db`.
  2) On pay‑success, `store-service` decrements `local_stock` and enqueues `order.created` in `outbox`.
  3) `order-service` periodically pulls from store `outbox` and imports into central `order-db`.
  4) Refunds at store enqueue `order.cancelled`; central updates order status to `CANCELLED` (idempotent by `store_order_id`).
- Inventory
  - Store manages `local_stock` (live truth for selling).
  - `inventory-service` pulls and upserts into `store_stock_mirror(store-001, …)`.
  - `central_stock` is HQ inventory and independent from the mirror; `stock_movements` records central ISSUES to stores.
- Menu
  - `menu-service` assembles the menu using store catalog (`local_items`) + availability from store `local_stock`.

## Roles and Security
- JWT tokens from `auth-service` attached by POS/Customer/Admin.
- POS actions require staff/manager; refunds and catalog edits (SKU name/price/active) require manager.
- Admin dashboard requires login; staff are read‑only.

## Failure Modes and Resilience
- If central services/DBs are down, the store continues selling against `store-001-db`; outbox drains when central recovers.
- If `menu-service` is down, customer UI reflects outage; POS can still sell using the store catalog and stock.

## Reporting
- Central sales reports: daily/weekly/monthly (PAID‑only), UTC time buckets; optional group‑by store; CSV export from Admin.

## Deployment and Runtime
- Defined in `docker-compose.yml` under `shuttle-sushi/`.
- Backends: `3001` (auth), `3002` (menu), `3003` (orders), `3004` (inventory), `3010` (store).
- Frontends: `8081` (POS), `8082` (Customer), `8083` (Admin).
- Frontends call backends via hardcoded `http://localhost:300x` (no proxy).

## Initialization & Ops
- Bootstrap: `bootstrap.sh` creates folder structure, service templates, schemas, seeds, and Compose.
- E2E: `scripts/e2e_smoke.sh` verifies health, order lifecycle, refunds propagation, mirror, and reports.
- DevOps references: `DEVOPS_DB_ADMIN_TASKS.md`, `DEVOPS_DB_ADMIN_CHEATSHEET.md`, `SCHEMA.md`, `DIAGRAMS.md`.

## Key Paths
- Compose: `shuttle-sushi/docker-compose.yml`
- Services: `shuttle-sushi/services/*/src/server.js`, `shuttle-sushi/services/*/db/schema.sql`
- Frontends: `shuttle-sushi/web/*/Dockerfile`, `shuttle-sushi/web/*/src/*`
- Documentation: `REPORT.md`, `REPORT_DAY2.md`, `REPORT_DAY3.md`, `REPORT_DAY4.md`, `SCHEMA.md`, `DIAGRAMS.md`

