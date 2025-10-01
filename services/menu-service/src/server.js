import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storePool = new Pool({ connectionString: process.env.STORE_DB_URL });

app.get("/health", async (_, res) => {
  try { await pool.query("select 1"); res.json({ ok: true, service: "menu-service" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- minimal demo endpoint per service ---
app.get("/", (_, res) => res.json({ service: "menu-service", ok: true }));

const port = process.env.PORT || 3002;
app.listen(port, () => console.log("menu-service on " + port));
// GET /menu returns items with availability; names/prices from store.local_items
app.get('/menu', async (_, res) => {
  try {
    // Prefer store DB as source of truth for name/price
    const { rows: items } = await storePool.query('select sku, name, price_cents, is_active from local_items where is_active=true');
    const { rows: stock } = await storePool.query('select sku, qty from local_stock');
    const qtyBySku = new Map(stock.map(x => [x.sku, Number(x.qty)]));
    const decorated = items.map(it => ({
      sku: it.sku,
      name: it.name,
      price_cents: it.price_cents,
      available: (qtyBySku.get(it.sku) || 0) > 0
    }));
    return res.json({ ok:true, items: decorated });
  } catch (e) {
    // Fallback to legacy menu_items + availability via minimal assumption (no store)
    try {
      const { rows: items } = await pool.query('select sku,name,price_cents,is_active from menu_items where is_active=true');
      return res.json({ ok:true, items: items.map(it => ({ sku: it.sku, name: it.name, price_cents: it.price_cents, available: true })) });
    } catch (ee) {
      return res.status(500).json({ ok:false, error: e.message });
    }
  }
});

// One-off migration helper: backfill store.local_items from legacy menu_items
app.post('/backfill-to-store', async (_req, res) => {
  const client = await storePool.connect();
  try {
    const { rows: items } = await pool.query('select sku, name, price_cents, is_active from menu_items');
    await client.query('begin');
    let n = 0;
    for (const it of items) {
      await client.query(
        `insert into local_items(sku, name, price_cents, is_active)
         values($1,$2,$3,$4)
         on conflict (sku) do update set name=excluded.name, price_cents=excluded.price_cents, is_active=excluded.is_active, updated_at=now()`,
        [it.sku, it.name, it.price_cents, it.is_active]
      );
      n++;
    }
    await client.query('commit');
    res.json({ ok:true, upserted: n });
  } catch (e) {
    await client.query('rollback').catch(()=>{});
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});
