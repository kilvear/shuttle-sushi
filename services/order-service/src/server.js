import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get("/health", async (_, res) => {
  try {
    // Ensure schema for refunds propagation
    await pool.query("alter table if exists orders add column if not exists store_order_id uuid");
    res.json({ ok: true, service: "order-service" });
  }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- minimal demo endpoint per service ---
app.get("/", (_, res) => res.json({ service: "order-service", ok: true }));

const port = process.env.PORT || 3003;
app.listen(port, () => console.log("order-service on " + port));

// Central pull: read store outbox and import to central orders
const storePool = new Pool({ connectionString: process.env.STORE_DB_URL });

async function importOrderPayload(payload) {
  const { store_id = "store-001", store_order_id = null, items = [], total_cents = 0, status = "PAID" } = payload || {};
  const client = await pool.connect(); // central order DB
  try {
    await client.query("begin");
    // Idempotency: if this store_order_id already imported, return it
    if (store_order_id) {
      const existing = await client.query(
        'select id from orders where store_id=$1 and store_order_id=$2 limit 1',
        [store_id, store_order_id]
      );
      if (existing.rows.length) {
        await client.query('commit');
        return existing.rows[0].id;
      }
    }
    const { rows: [order] } = await client.query(
      "insert into orders(store_id, store_order_id, total_cents, status) values($1,$2,$3,$4) returning id",
      [store_id, store_order_id, total_cents, status]
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
    "select * from outbox where delivered=false order by id asc limit 20"
  );
  for (const ev of rows) {
    try {
      if (ev.topic === 'order.created') {
        await importOrderPayload(ev.payload);
      } else if (ev.topic === 'order.cancelled') {
        const p = ev.payload || {};
        const store_id = p.store_id || 'store-001';
        const store_order_id = p.store_order_id || null;
        if (store_order_id) {
          await pool.query(
            "update orders set status='CANCELLED' where store_id=$1 and store_order_id=$2",
            [store_id, store_order_id]
          );
        } else {
          throw new Error('missing store_order_id for order.cancelled');
        }
      } else {
        // Unknown topic: ignore but mark as delivered to avoid deadlock
      }
      await storePool.query("update outbox set delivered=true, last_error=null where id=$1", [ev.id]);
    } catch (e) {
      await storePool.query("update outbox set last_error=$1 where id=$2", [e.message, ev.id]);
    }
  }
}

setInterval(() => drainStoreOutbox().catch(console.error), Number(process.env.PULL_INTERVAL_MS || 3000));

// --- Read endpoints for dashboard ---
// GET /orders?limit=50 -> recent central orders with items
app.get('/orders', async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const client = await pool.connect();
  try {
    const { rows: orders } = await client.query(
      'select id, store_id, customer_id, total_cents, status, created_at from orders order by created_at desc limit $1',
      [limit]
    );
    const out = [];
    for (const o of orders) {
      const { rows: items } = await client.query(
        'select sku, qty, price_cents from order_items where order_id=$1', [o.id]
      );
      out.push({ ...o, items });
    }
    res.json({ ok:true, orders: out });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

// GET /outbox/summary -> store outbox status (via central reader)
app.get('/outbox/summary', async (_req, res) => {
  try {
    const { rows: undel } = await storePool.query('select count(*)::int as c from outbox where delivered=false');
    const undelivered = undel[0]?.c || 0;
    const { rows: last10 } = await storePool.query(
      'select id, topic, delivered, left(coalesce(last_error,\'\'), 120) as last_error, created_at from outbox order by id desc limit 10'
    );
    res.json({ ok:true, undelivered, last_10: last10 });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// GET /reports/sales -> aggregated sales by day/week/month (PAID only)
// Query params:
//   period = 'day' | 'week' | 'month' (default: 'day')
//   days | weeks | months (defaults: 21 days, 3 weeks, 3 months)
//   from, to = ISO timestamps (optional; overrides defaults)
// Returns: { ok:true, period, buckets:[{ bucket, orders, revenue_cents }] }
app.get('/reports/sales', async (req, res) => {
  const period = (req.query.period || 'day').toString();
  const groupBy = String(req.query.group_by||'').toLowerCase();
  const byStore = groupBy === 'store';
  const valid = new Set(['day','week','month']);
  if (!valid.has(period)) return res.status(400).json({ ok:false, error:'invalid period' });

  const client = await pool.connect();
  try {
    // Determine range
    const now = new Date();
    const toParam = req.query.to ? new Date(String(req.query.to)) : null;
    const fromParam = req.query.from ? new Date(String(req.query.from)) : null;

    // Truncate helper (UTC-based via Postgres date_trunc in query)
    // Compute defaults if no explicit from/to
    let step = '1 day';
    let defaultCount = 21; // days
    if (period === 'week') { step = '1 week'; defaultCount = 3; }
    if (period === 'month') { step = '1 month'; defaultCount = 3; }
    // Optional overrides if provided and sane
    const qDays = Number(req.query.days);
    const qWeeks = Number(req.query.weeks);
    const qMonths = Number(req.query.months);
    if (!fromParam || !toParam) {
      if (period === 'day' && Number.isFinite(qDays) && qDays > 0 && qDays <= 180) defaultCount = Math.floor(qDays);
      if (period === 'week' && Number.isFinite(qWeeks) && qWeeks > 0 && qWeeks <= 52) defaultCount = Math.floor(qWeeks);
      if (period === 'month' && Number.isFinite(qMonths) && qMonths > 0 && qMonths <= 24) defaultCount = Math.floor(qMonths);
    }

    // Build SQL using Postgres date_trunc and generate_series to ensure empty buckets
    // Compute series start/end in SQL to avoid JS timezone pitfalls when from/to not provided
    const params = { step, defaultCount };

    // Prefer explicit from/to when provided
    let whereRangeSQL = '';
    const values = [];
    let vi = 1;
    if (fromParam && !isNaN(fromParam) && toParam && !isNaN(toParam)) {
      whereRangeSQL = `created_at >= $${vi++} and created_at <= $${vi++}`;
      values.push(fromParam.toISOString(), toParam.toISOString());
    } else {
      // Use now() truncated to period boundaries in SQL
      whereRangeSQL = `created_at >= date_trunc('${period}', now()) - interval '${defaultCount-1} ${period === 'day' ? 'days' : period + 's'}'
                       and created_at <= date_trunc('${period}', now())`;
    }

    let sql;
    if (fromParam && toParam && !isNaN(fromParam) && !isNaN(toParam)) {
      if (!byStore) {
        sql = `
          with series as (
            select generate_series(
              date_trunc('${period}', $${values.length-1}),
              date_trunc('${period}', $${values.length}),
              interval '${step}'
            ) as bucket
          ), agg as (
            select date_trunc('${period}', created_at) as bucket,
                   count(*)::int as orders,
                   coalesce(sum(total_cents),0)::bigint as revenue_cents
            from orders
            where status='PAID' and ${whereRangeSQL}
            group by 1
          )
          select s.bucket, coalesce(a.orders,0) as orders, coalesce(a.revenue_cents,0) as revenue_cents
          from series s
          left join agg a on a.bucket = s.bucket
          order by s.bucket asc`;
      } else {
        sql = `
          with series as (
            select generate_series(
              date_trunc('${period}', $${values.length-1}),
              date_trunc('${period}', $${values.length}),
              interval '${step}'
            ) as bucket
          ), stores as (
            select distinct store_id from orders where ${whereRangeSQL}
            union select 'store-001'
          ), grid as (
            select st.store_id, se.bucket from stores st cross join series se
          ), agg as (
            select store_id, date_trunc('${period}', created_at) as bucket,
                   count(*)::int as orders,
                   coalesce(sum(total_cents),0)::bigint as revenue_cents
            from orders
            where status='PAID' and ${whereRangeSQL}
            group by 1, 2
          )
          select g.store_id, g.bucket, coalesce(a.orders,0) as orders, coalesce(a.revenue_cents,0) as revenue_cents
          from grid g
          left join agg a on a.store_id = g.store_id and a.bucket = g.bucket
          order by g.store_id asc, g.bucket asc`;
      }
    } else {
      if (!byStore) {
        sql = `
          with bounds as (
            select date_trunc('${period}', now()) as t_to,
                   date_trunc('${period}', now()) - interval '${defaultCount-1} ${period === 'day' ? 'days' : period + 's'}' as t_from
          ), series as (
            select generate_series((select t_from from bounds), (select t_to from bounds), interval '${step}') as bucket
          ), agg as (
            select date_trunc('${period}', created_at) as bucket,
                   count(*)::int as orders,
                   coalesce(sum(total_cents),0)::bigint as revenue_cents
            from orders
            where status='PAID' and ${whereRangeSQL}
            group by 1
          )
          select s.bucket, coalesce(a.orders,0) as orders, coalesce(a.revenue_cents,0) as revenue_cents
          from series s
          left join agg a on a.bucket = s.bucket
          order by s.bucket asc`;
      } else {
        sql = `
          with bounds as (
            select date_trunc('${period}', now()) as t_to,
                   date_trunc('${period}', now()) - interval '${defaultCount-1} ${period === 'day' ? 'days' : period + 's'}' as t_from
          ), series as (
            select generate_series((select t_from from bounds), (select t_to from bounds), interval '${step}') as bucket
          ), stores as (
            select distinct store_id from orders where ${whereRangeSQL}
            union select 'store-001'
          ), grid as (
            select st.store_id, se.bucket from stores st cross join series se
          ), agg as (
            select store_id, date_trunc('${period}', created_at) as bucket,
                   count(*)::int as orders,
                   coalesce(sum(total_cents),0)::bigint as revenue_cents
            from orders
            where status='PAID' and ${whereRangeSQL}
            group by 1, 2
          )
          select g.store_id, g.bucket, coalesce(a.orders,0) as orders, coalesce(a.revenue_cents,0) as revenue_cents
          from grid g
          left join agg a on a.store_id = g.store_id and a.bucket = g.bucket
          order by g.store_id asc, g.bucket asc`;
      }
    }

    const { rows } = await client.query(sql, values);
    if (!byStore) {
      res.json({ ok:true, period, buckets: rows.map(r => ({
        bucket: r.bucket,
        orders: Number(r.orders||0),
        revenue_cents: Number(r.revenue_cents||0)
      })) });
    } else {
      // group rows by store_id
      const by = new Map();
      for (const r of rows) {
        const k = r.store_id;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push({
          bucket: r.bucket,
          orders: Number(r.orders||0),
          revenue_cents: Number(r.revenue_cents||0)
        });
      }
      const stores = Array.from(by.entries()).map(([store_id, buckets]) => ({ store_id, buckets }));
      res.json({ ok:true, period, group_by:'store', stores });
    }
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});
