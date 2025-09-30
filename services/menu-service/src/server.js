import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get("/health", async (_, res) => {
  try { await pool.query("select 1"); res.json({ ok: true, service: "menu-service" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- minimal demo endpoint per service ---
app.get("/", (_, res) => res.json({ service: "menu-service", ok: true }));

const port = process.env.PORT || 3002;
app.listen(port, () => console.log("menu-service on " + port));
import fetch from 'node-fetch';

// GET /menu returns items with availability flag; hides quantities
app.get('/menu', async (_, res) => {
  try {
    const { rows: items } = await pool.query('select sku,name,price_cents,is_active from menu_items where is_active=true');
    // Ask store-service for availability
    const r = await fetch('http://store-service:3010/availability');
    if (!r.ok) throw new Error('availability fetch failed');
    const avail = await r.json();
    const qtyBySku = new Map((avail.items || []).map(x => [x.sku, Number(x.qty)]));
    const decorated = items.map(it => ({
      sku: it.sku,
      name: it.name,
      price_cents: it.price_cents,
      available: (qtyBySku.get(it.sku) || 0) > 0
    }));
    res.json({ ok:true, items: decorated });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});
