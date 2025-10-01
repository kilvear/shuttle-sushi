import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;
import jwt from 'jsonwebtoken';

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

app.get("/health", async (_, res) => {
  try { await pool.query("select 1"); res.json({ ok: true, service: "store-service" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- minimal demo endpoint per service ---
app.get("/", (_, res) => res.json({ service: "store-service", ok: true }));

const port = process.env.PORT || 3010;
app.listen(port, () => console.log("store-service on " + port));

// Simple POS/customer endpoints (store-local)
const STORE_ID = 'store-001';

// Price lookup helper (server-side pricing)
async function fetchPriceMap() {
  const base = process.env.MENU_API_URL || 'http://menu-service:3002';
  const r = await fetch(base + '/menu');
  if (!r.ok) throw new Error('menu-service unavailable');
  const data = await r.json();
  const map = new Map();
  for (const it of (data.items || [])) {
    // only active items are returned by menu-service
    map.set(it.sku, Number(it.price_cents));
  }
  return map;
}

// Create local order (guest by default)
app.post('/orders', async (req, res) => {
  try {
    const { items = [], customer_id = null, is_guest = true } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ ok:false, error:'items required' });

    // Authoritative price lookup from menu-service
    const prices = await fetchPriceMap();

    // Validate items and compute totals with server-side prices
    const normalized = [];
    let total = 0;
    for (const raw of items) {
      const sku = String(raw.sku || '').trim();
      const qty = Number(raw.qty);
      if (!sku || !Number.isFinite(qty) || qty <= 0) return res.status(400).json({ ok:false, error:'invalid item qty/sku' });
      const price = prices.get(sku);
      if (!Number.isFinite(price)) return res.status(400).json({ ok:false, error:`unknown sku ${sku}` });
      normalized.push({ sku, qty, price_cents: price });
      total += qty * price;
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      // Generate guest id if needed
      const guestIdRow = await client.query('select gen_random_uuid() as id');
      const guest_id = customer_id || guestIdRow.rows[0].id;
      const { rows: [order] } = await client.query(
        'insert into local_orders(customer_id,is_guest,total_cents,status) values($1,$2,$3,$4) returning id',
        [guest_id, is_guest || !customer_id, total, 'PENDING']
      );
      for (const it of normalized) {
        await client.query(
          'insert into local_order_items(order_id, sku, qty, price_cents) values($1,$2,$3,$4)',
          [order.id, it.sku, it.qty, it.price_cents]
        );
      }
      await client.query('commit');
      res.json({ ok:true, id: order.id, customer_id: guest_id, total_cents: total });
    } catch (e) {
      await client.query('rollback');
      res.status(500).json({ ok:false, error:e.message });
    } finally {
      client.release();
    }
  } catch (e) {
    const code = e.message && e.message.includes('menu-service') ? 502 : 500;
    res.status(code).json({ ok:false, error:e.message });
  }
});

// Payment success: decrement stock, mark PAID, enqueue outbox
app.post('/orders/:id/pay-success', async (req, res) => {
  const orderId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: orderRows } = await client.query('select * from local_orders where id=$1 for update', [orderId]);
    if (orderRows.length === 0) { await client.query('rollback'); return res.status(404).json({ ok:false, error:'order not found' }); }
    if (orderRows[0].status === 'PAID') { await client.query('rollback'); return res.json({ ok:true, id: orderId, status:'PAID' }); }
    const { rows: items } = await client.query('select sku, qty, price_cents from local_order_items where order_id=$1', [orderId]);
    // Check and decrement stock atomically per item
    for (const it of items) {
      const r = await client.query('update local_stock set qty = qty - $1, updated_at=now() where sku=$2 and qty >= $1', [it.qty, it.sku]);
      if (r.rowCount === 0) { throw new Error(`out of stock for ${it.sku}`); }
    }
    await client.query('update local_orders set status=$1 where id=$2', ['PAID', orderId]);
    const total = items.reduce((s, it) => s + it.qty * it.price_cents, 0);
    await client.query('insert into outbox(topic,payload) values($1,$2::jsonb)', [
      'order.created',
      JSON.stringify({ store_id: STORE_ID, store_order_id: orderId, items, total_cents: total, status: 'PAID' })
    ]);
    await client.query('commit');
    res.json({ ok:true, id: orderId, status:'PAID' });
  } catch (e) {
    await client.query('rollback');
    res.status(409).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

// Optional payment failure (for customer flow)
app.post('/orders/:id/pay-failure', async (req, res) => {
  const orderId = req.params.id;
  try {
    await pool.query('update local_orders set status=$1 where id=$2 and status<>$1', ['CANCELLED', orderId]);
    res.json({ ok:true, id: orderId, status:'CANCELLED' });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Availability snapshot for menu-service
app.get('/availability', async (_, res) => {
  try {
    const { rows } = await pool.query('select sku, qty from local_stock');
    res.json({ ok:true, items: rows });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// List recent local orders for POS viewing (place BEFORE /orders/:id)
app.get('/orders/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const client = await pool.connect();
  try {
    const { rows: orders } = await client.query(
      `select o.id, o.total_cents, o.status, o.created_at
         from local_orders o
        order by o.created_at desc
        limit $1`, [limit]
    );
    if (orders.length === 0) return res.json({ ok:true, orders: [] });
    const ids = orders.map(o => o.id);
    const { rows: counts } = await client.query(
      `select order_id, count(*)::int as item_count
         from local_order_items
        where order_id = any($1::uuid[])
        group by order_id`, [ids]
    );
    const countById = new Map(counts.map(r => [r.order_id, Number(r.item_count)]));
    const enriched = orders.map(o => ({ ...o, item_count: countById.get(o.id) || 0 }));
    res.json({ ok:true, orders: enriched });
  } catch (e) {
    console.error('orders/recent error:', e.message);
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

// Get order status/details
app.get('/orders/:id', async (req, res) => {
  const orderId = req.params.id;
  try {
    const { rows: [order] } = await pool.query('select id, customer_id, is_guest, total_cents, status, created_at from local_orders where id=$1', [orderId]);
    if (!order) return res.status(404).json({ ok:false, error:'not found' });
    const { rows: items } = await pool.query('select sku, qty, price_cents from local_order_items where order_id=$1', [orderId]);
    res.json({ ok:true, order: { ...order, items } });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

 

// --- Manager-only: refund a PAID order (inventory reversal)
function requireManager(req, res, next){
  try {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok:false, error:'missing token' });
    const user = jwt.verify(token, JWT_SECRET);
    if (user?.role !== 'manager') return res.status(403).json({ ok:false, error:'manager role required' });
    req.user = user; next();
  } catch(e){
    return res.status(401).json({ ok:false, error:'invalid token' });
  }
}

function requireEmployee(req, res, next){
  try {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok:false, error:'missing token' });
    const user = jwt.verify(token, JWT_SECRET);
    if (user?.role !== 'manager' && user?.role !== 'staff') {
      return res.status(403).json({ ok:false, error:'staff or manager role required' });
    }
    req.user = user; next();
  } catch(e){
    return res.status(401).json({ ok:false, error:'invalid token' });
  }
}

// Inventory: set absolute quantity (staff/manager)
app.post('/inventory/set', requireEmployee, async (req, res) => {
  const { sku, qty } = req.body || {};
  const nqty = Number(qty);
  if (!sku || !Number.isFinite(nqty)) return res.status(400).json({ ok:false, error:'sku and qty required' });
  if (nqty < 0) return res.status(400).json({ ok:false, error:'qty must be >= 0' });
  try {
    const { rows: [row] } = await pool.query(
      `insert into local_stock(sku, qty) values($1,$2)
       on conflict (sku) do update set qty=excluded.qty, updated_at=now()
       returning sku, qty`, [sku, nqty]
    );
    res.json({ ok:true, item: row });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Inventory: adjust by delta (staff/manager)
app.post('/inventory/adjust', requireEmployee, async (req, res) => {
  const { sku, delta } = req.body || {};
  const ndelta = Number(delta);
  if (!sku || !Number.isFinite(ndelta)) return res.status(400).json({ ok:false, error:'sku and delta required' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query('select qty from local_stock where sku=$1 for update', [sku]);
    const current = rows.length ? Number(rows[0].qty) : 0;
    const next = current + ndelta;
    if (next < 0) { await client.query('rollback'); return res.status(400).json({ ok:false, error:'resulting qty would be negative' }); }
    const { rows: [row] } = await client.query(
      `insert into local_stock(sku, qty) values($1,$2)
       on conflict (sku) do update set qty=excluded.qty, updated_at=now()
       returning sku, qty`, [sku, next]
    );
    await client.query('commit');
    res.json({ ok:true, item: row });
  } catch (e) {
    await client.query('rollback');
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});
app.post('/orders/:id/refund', requireManager, async (req, res) => {
  const orderId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: [order] } = await client.query('select id, status from local_orders where id=$1 for update', [orderId]);
    if (!order) { await client.query('rollback'); return res.status(404).json({ ok:false, error:'order not found' }); }
    if (order.status !== 'PAID') { await client.query('rollback'); return res.status(409).json({ ok:false, error:'only PAID orders can be refunded' }); }
    const { rows: items } = await client.query('select sku, qty from local_order_items where order_id=$1', [orderId]);
    for (const it of items) {
      await client.query('update local_stock set qty = qty + $1, updated_at=now() where sku=$2', [it.qty, it.sku]);
    }
    await client.query('update local_orders set status=$1 where id=$2', ['CANCELLED', orderId]);
    // Enqueue a cancellation event so central can reflect refund
    await client.query('insert into outbox(topic,payload) values($1,$2::jsonb)', [
      'order.cancelled',
      JSON.stringify({ store_id: STORE_ID, store_order_id: orderId })
    ]);
    await client.query('commit');
    res.json({ ok:true, id: orderId, status:'CANCELLED' });
  } catch(e){
    await client.query('rollback');
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});
