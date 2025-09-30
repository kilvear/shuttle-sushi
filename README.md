# shuttle-sushi (MVP)

- Service-per-DB (Postgres 16)
- Simple Express + pg per service
- Store-local DB with Outbox + Central Pullers

## Run
docker compose up -d --build
curl http://localhost:3002/health  # menu-service
curl http://localhost:3010/health  # store-service
curl http://localhost:3003/health  # order-service
