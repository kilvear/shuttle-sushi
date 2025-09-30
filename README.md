Shuttle Sushi — Restaurant Management Suite (Capstone Project)

Shuttle Sushi is a lean, service‑per‑database restaurant management suite built for a sushi shop scenario. It models both a customer ordering portal and a point‑of‑sale (POS) used by staff, with an emphasis on resilience during partial service outages.

This repository is part of a capstone project.

Concept
- Service‑per‑DB: Each backend service owns its data and exposes HTTP APIs. No cross‑DB joins.
- Offline‑first store: Each store keeps a local database so the POS continues to function if central services are unavailable.
- Central pull sync: Central services periodically pull from the store (orders, inventory) and update central state when online.

Core Services (high‑level)
- Auth Service: Issues JWTs for customers and staff (login/register/me).
- Menu Service: Central catalog; frontends read menu and see what’s available.
- Order Service: Central record of orders; pulls paid orders from the store.
- Inventory Service: Central inventory; mirrors a store’s local stock.
- Store Service: Store‑level operations (create orders, pay success/cancel, local stock, outbox for offline sync).

Frontends (high‑level)
- POS Web (staff): Role‑gated (staff/manager), place orders, manage local stock, handle refunds.
- Customer Web: Browse menu, add to cart, simulate checkout.
- Admin Dashboard: Read‑only status and views (services up/down, recent orders, outbox, inventory compare, users list).

How Things Interact (simplified)
- POS/Customer create orders via the Store Service (talking to the store’s local DB).
- On payment success, the Store enqueues an event in its outbox (no immediate central call).
- The Order Service (central) periodically pulls from the store outbox and records orders centrally.
- The Inventory Service (central) periodically mirrors the store’s local stock into central stock for that store.
- The Menu Service provides the catalog and marks items as available by checking the store’s local availability snapshot.

Project Stage
- MVP is complete; ongoing work focuses on polish and features (e.g., sales reports in the dashboard, simple admin controls, UI improvements).
- Technical setup and API details are intentionally not included here while features are still evolving.

Notes
- For deeper architecture and current endpoints, see the project reports and schema documents in this repository.
- This is a capstone project; scope and components may change as features are added.
