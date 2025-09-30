import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get("/health", async (_, res) => {
  try { await pool.query("select 1"); res.json({ ok: true, service: "order-service" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- minimal demo endpoint per service ---
app.get("/", (_, res) => res.json({ service: "order-service", ok: true }));

const port = process.env.PORT || 3003;
app.listen(port, () => console.log("order-service on " + port));

// Central pull: read store outbox and import to central orders
const storePool = new Pool({ connectionString: process.env.STORE_DB_URL });

async function importOrderPayload(payload) {
  const { store_id = "store-001", items = [], total_cents = 0, status = "PAID" } = payload || {};
  const client = await pool.connect(); // central order DB
  try {
    await client.query("begin");
    const { rows: [order] } = await client.query(
      "insert into orders(store_id,total_cents,status) values($1,$2,$3) returning id",
      [store_id, total_cents, status]
    );
    for (const it of items) {
      await client.query(
        "insert into order_items(order_id, sku, qty, price_cents) values($1,$2,$3,$4)",
        [order.id, it.sku, it.qty, it.price_cents]
      );
    }
    await client.query("commit");
    return order.id;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

async function drainStoreOutbox() {
  const { rows } = await storePool.query(
    "select * from outbox where delivered=false and topic='order.created' order by id asc limit 20"
  );
  for (const ev of rows) {
    try {
      await importOrderPayload(ev.payload);
      await storePool.query("update outbox set delivered=true, last_error=null where id=$1", [ev.id]);
    } catch (e) {
      await storePool.query("update outbox set last_error=$1 where id=$2", [e.message, ev.id]);
    }
  }
}

setInterval(() => drainStoreOutbox().catch(console.error), Number(process.env.PULL_INTERVAL_MS || 3000));
