import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

// Helper to compute total
function calcTotal(items = []) {
  return items.reduce((sum, it) => sum + (Number(it.price_cents) * Number(it.qty)), 0);
}

// Create local order (guest by default)
app.post('/orders', async (req, res) => {
  const { items = [], customer_id = null, is_guest = true } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ ok:false, error:'items required' });
  const total = calcTotal(items);
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
    for (const it of items) {
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
      JSON.stringify({ store_id: STORE_ID, items, total_cents: total, status: 'PAID' })
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
