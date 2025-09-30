import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get("/health", async (_, res) => {
  try { await pool.query("select 1"); res.json({ ok: true, service: "inventory-service" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- minimal demo endpoint per service ---
app.get("/", (_, res) => res.json({ service: "inventory-service", ok: true }));

const port = process.env.PORT || 3004;
app.listen(port, () => console.log("inventory-service on " + port));

// Central pull: mirror store local_stock into central inventory stock
const storePoolInv = new Pool({ connectionString: process.env.STORE_DB_URL });
const STORE_LOCATION = 'store-001';

async function mirrorStoreStock() {
  const client = await pool.connect(); // central inventory DB
  try {
    const { rows } = await storePoolInv.query('select sku, qty from local_stock');
    await client.query('begin');
    for (const r of rows) {
      const { rows: existing } = await client.query('select id from stock where sku=$1 and location=$2', [r.sku, STORE_LOCATION]);
      if (existing.length > 0) {
        await client.query('update stock set qty=$1 where id=$2', [r.qty, existing[0].id]);
      } else {
        await client.query('insert into stock(sku, qty, location) values($1,$2,$3)', [r.sku, r.qty, STORE_LOCATION]);
      }
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(()=>{});
    console.error('mirror error', e.message);
  } finally {
    client.release();
  }
}

setInterval(() => mirrorStoreStock().catch(console.error), Number(process.env.PULL_INTERVAL_MS || 5000));

// Manual trigger: force a one-time mirror from store -> central
app.post('/mirror-now', async (_req, res) => {
  try { await mirrorStoreStock(); res.json({ ok:true }); }
  catch (e) { res.status(500).json({ ok:false, error: e.message }); }
});

// Reset sync: make central exactly match store for Store 1 (prune extras, upsert all)
app.post('/mirror-reset', async (_req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await storePoolInv.query('select sku, qty from local_stock');
    const skus = rows.map(r => r.sku);
    await client.query('begin');
    // Delete central rows for this store that no longer exist in store
    await client.query('delete from stock where location=$1 and ($2::text[]) is not null and sku <> all($2::text[])', [STORE_LOCATION, skus]);
    // Upsert all current store rows
    for (const r of rows) {
      const { rows: existing } = await client.query('select id from stock where sku=$1 and location=$2', [r.sku, STORE_LOCATION]);
      if (existing.length > 0) {
        await client.query('update stock set qty=$1 where id=$2', [r.qty, existing[0].id]);
      } else {
        await client.query('insert into stock(sku, qty, location) values($1,$2,$3)', [r.sku, r.qty, STORE_LOCATION]);
      }
    }
    await client.query('commit');
    res.json({ ok:true, updated: rows.length });
  } catch (e) {
    await client.query('rollback').catch(()=>{});
    res.status(500).json({ ok:false, error: e.message });
  } finally {
    client.release();
  }
});

// --- Read endpoint for dashboard ---
// GET /stock?location=central|store-001
app.get('/stock', async (req, res) => {
  const location = String(req.query.location || 'central');
  try {
    const { rows } = await pool.query('select sku, qty, location from stock where location=$1 order by sku asc', [location]);
    res.json({ ok:true, items: rows });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});
