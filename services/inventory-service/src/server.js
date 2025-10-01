import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// --- Schema setup and migration (split central vs store mirror) ---
async function ensureSchemaAndMigrate() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    // New tables
    await client.query(`
      create table if not exists central_stock(
        sku text primary key,
        qty int not null default 0,
        updated_at timestamptz default now()
      );
    `);
    await client.query(`
      create table if not exists store_stock_mirror(
        store_id text not null,
        sku text not null,
        qty int not null default 0,
        updated_at timestamptz default now(),
        primary key (store_id, sku)
      );
    `);
    await client.query(`
      create table if not exists stock_movements(
        id uuid primary key default gen_random_uuid(),
        sku text not null,
        qty int not null,
        movement_type text not null,
        source_location text,
        dest_location text,
        store_id text,
        ref text,
        note text,
        created_at timestamptz default now()
      );
    `);

    // Detect old single-table schema named 'stock'
    const { rows: old } = await client.query(`
      select 1 from information_schema.tables where table_name='stock' and table_schema='public' limit 1
    `);
    if (old.length) {
      // Migrate data if new tables are empty
      const { rows: ccount } = await client.query('select count(*)::int as c from central_stock');
      const { rows: scount } = await client.query('select count(*)::int as c from store_stock_mirror');
      const centralEmpty = (ccount[0]?.c||0) === 0;
      const storeEmpty = (scount[0]?.c||0) === 0;
      if (centralEmpty) {
        await client.query(`
          insert into central_stock(sku, qty)
          select sku, qty from stock where location='central' or location is null
          on conflict (sku) do nothing
        `);
      }
      if (storeEmpty) {
        await client.query(`
          insert into store_stock_mirror(store_id, sku, qty)
          select location as store_id, sku, qty from stock where location like 'store-%'
          on conflict (store_id, sku) do nothing
        `);
      }
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(()=>{});
    console.error('schema migration error', e.message);
  } finally {
    client.release();
  }
}

app.get("/health", async (_, res) => {
  try { await pool.query("select 1"); await ensureSchemaAndMigrate(); res.json({ ok: true, service: "inventory-service" }); }
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
      await client.query(
        `insert into store_stock_mirror(store_id, sku, qty) values($1,$2,$3)
         on conflict (store_id, sku) do update set qty=excluded.qty, updated_at=now()`,
        [STORE_LOCATION, r.sku, r.qty]
      );
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
    // Replace mirror for this store with current store rows
    await client.query('delete from store_stock_mirror where store_id=$1', [STORE_LOCATION]);
    for (const r of rows) {
      await client.query('insert into store_stock_mirror(store_id, sku, qty) values($1,$2,$3)', [STORE_LOCATION, r.sku, r.qty]);
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

// --- Read endpoint for dashboard (compat via UNION) ---
// GET /stock?location=central|store-001
app.get('/stock', async (req, res) => {
  const location = String(req.query.location || 'central');
  try {
    if (location === 'central') {
      const { rows } = await pool.query("select sku, qty, 'central' as location from central_stock order by sku asc");
      return res.json({ ok:true, items: rows });
    }
    const { rows } = await pool.query('select sku, qty, store_id as location from store_stock_mirror where store_id=$1 order by sku asc', [location]);
    res.json({ ok:true, items: rows });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// List known stores (from mirror)
app.get('/stores', async (_req, res) => {
  try {
    const { rows } = await pool.query("select distinct store_id from store_stock_mirror order by store_id asc");
    const list = rows.map(r => r.store_id);
    res.json({ ok:true, stores: list.length ? list : ['store-001'] });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// --- Central administration endpoints (location='central') ---
// List central stock with optional search & paging
app.get('/central/stock', async (req, res) => {
  const search = (req.query.search || '').toString().trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
  try {
    const q = search ?
      `select sku, qty from central_stock where sku ilike $1 order by sku asc limit $2` :
      `select sku, qty from central_stock order by sku asc limit $1`;
    const params = search ? ['%'+search+'%', limit] : [limit];
    const { rows } = await pool.query(q, params);
    res.json({ ok:true, items: rows });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Create a new central SKU (no deletion per requirement)
app.post('/central/sku', async (req, res) => {
  const { sku, qty } = req.body || {};
  const nqty = Number(qty);
  if (!sku || !Number.isFinite(nqty) || nqty < 0) return res.status(400).json({ ok:false, error:'valid sku and non-negative qty required' });
  try {
    const { rows: exist } = await pool.query('select 1 from central_stock where sku=$1', [sku]);
    if (exist.length) return res.status(409).json({ ok:false, error:'sku already exists in central' });
    await pool.query('insert into central_stock(sku, qty) values($1,$2)', [sku, nqty]);
    res.json({ ok:true, sku, qty:nqty });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Set absolute quantity for central SKU (no hard cap; must be >=0)
app.post('/central/set', async (req, res) => {
  const { sku, qty } = req.body || {};
  const nqty = Number(qty);
  if (!sku || !Number.isFinite(nqty) || nqty < 0) return res.status(400).json({ ok:false, error:'valid sku and non-negative qty required' });
  try {
    const r = await pool.query(`update central_stock set qty=$1, updated_at=now() where sku=$2`, [nqty, sku]);
    if (r.rowCount === 0) {
      await pool.query(`insert into central_stock(sku, qty) values($1,$2)`, [sku, nqty]);
    }
    res.json({ ok:true, sku, qty: nqty });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Adjust central quantity by delta (|delta| <= 10000, final >= 0)
app.post('/central/adjust', async (req, res) => {
  const { sku, delta } = req.body || {};
  const ndelta = Number(delta);
  if (!sku || !Number.isFinite(ndelta)) return res.status(400).json({ ok:false, error:'valid sku and delta required' });
  if (Math.abs(ndelta) > 10000) return res.status(400).json({ ok:false, error:'delta exceeds limit 10000' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query('select qty from central_stock where sku=$1 for update', [sku]);
    const current = rows.length ? Number(rows[0].qty) : 0;
    const next = current + ndelta;
    if (next < 0) { await client.query('rollback'); return res.status(400).json({ ok:false, error:'resulting qty would be negative' }); }
    if (rows.length) {
      await client.query('update central_stock set qty=$1, updated_at=now() where sku=$2', [next, sku]);
    } else {
      await client.query('insert into central_stock(sku, qty) values($1,$2)', [sku, next]);
    }
    await client.query('commit');
    res.json({ ok:true, sku, qty: next });
  } catch (e) {
    await client.query('rollback').catch(()=>{});
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

// --- Initialize central from store mirror (one-time baseline) ---
app.post('/central/seed-from-store', async (req, res) => {
  const storeId = String(req.body?.store_id || STORE_LOCATION);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query('select sku, qty from store_stock_mirror where store_id=$1', [storeId]);
    for (const r of rows) {
      const up = await client.query('update central_stock set qty=$1, updated_at=now() where sku=$2', [r.qty, r.sku]);
      if (up.rowCount === 0) {
        await client.query('insert into central_stock(sku, qty) values($1,$2)', [r.sku, r.qty]);
      }
    }
    await client.query('commit');
    res.json({ ok:true, seeded: rows.length, store_id: storeId });
  } catch (e) {
    await client.query('rollback').catch(()=>{});
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

// --- Record central issuance to a store (ledger only) ---
app.post('/central/issue', async (req, res) => {
  const { sku, qty, store_id, note } = req.body || {};
  const nqty = Number(qty);
  if (!sku || !store_id || !Number.isFinite(nqty) || nqty <= 0) return res.status(400).json({ ok:false, error:'sku, store_id and positive qty required' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query('select qty from central_stock where sku=$1 for update', [sku]);
    const current = rows.length ? Number(rows[0].qty) : 0;
    if (current < nqty) { await client.query('rollback'); return res.status(400).json({ ok:false, error:'insufficient central stock' }); }
    await client.query('update central_stock set qty = qty - $1, updated_at=now() where sku=$2', [nqty, sku]);
    await client.query(
      `insert into stock_movements(sku, qty, movement_type, source_location, dest_location, store_id, note)
       values($1,$2,'ISSUE','central',$3,$4,$5)`,
      [sku, nqty, store_id, store_id, note||null]
    );
    await client.query('commit');
    res.json({ ok:true });
  } catch (e) {
    await client.query('rollback').catch(()=>{});
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

// Movements listing with filters and pagination
// GET /movements?sku=&store_id=&from=&to=&limit=&offset=
app.get('/movements', async (req, res) => {
  const sku = (req.query.sku||'').toString().trim();
  const storeId = (req.query.store_id||'').toString().trim();
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  let limit = Number(req.query.limit || 100); if (!Number.isFinite(limit)) limit = 100; limit = Math.min(Math.max(limit, 1), 200);
  let offset = Number(req.query.offset || 0); if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const where = [];
  const vals = [];
  let i = 1;
  if (sku) { where.push(`sku ilike $${i++}`); vals.push('%'+sku+'%'); }
  if (storeId) { where.push(`store_id = $${i++}`); vals.push(storeId); }
  if (from && !isNaN(from)) { where.push(`created_at >= $${i++}`); vals.push(from.toISOString()); }
  if (to && !isNaN(to)) { where.push(`created_at <= $${i++}`); vals.push(to.toISOString()); }
  const whereSQL = where.length ? ('where ' + where.join(' and ')) : '';
  const sql = `select id, sku, qty, movement_type, source_location, dest_location, store_id, ref, note, created_at
               from stock_movements ${whereSQL}
               order by created_at desc, id desc
               limit $${i++} offset $${i++}`;
  vals.push(limit, offset);
  try {
    const { rows } = await pool.query(sql, vals);
    res.json({ ok:true, items: rows, next_offset: offset + rows.length });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});
