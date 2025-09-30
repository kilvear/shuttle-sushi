import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get("/health", async (_, res) => {
  try { await pool.query("select 1"); res.json({ ok: true, service: "auth-service" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- minimal demo endpoint per service ---
app.get("/", (_, res) => res.json({ service: "auth-service", ok: true }));

const port = process.env.PORT || 3001;
app.listen(port, () => console.log("auth-service on " + port));

// --- JWT login/register + demo seed ---
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

async function ensureDemoUsers() {
  const users = [
    { email: 'manager@example.com', role: 'manager', password: 'password123' },
    { email: 'staff@example.com', role: 'staff', password: 'password123' },
    { email: 'alice@example.com', role: 'customer', password: 'password123' },
    { email: 'bob@example.com', role: 'customer', password: 'password123' }
  ];
  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      'insert into users(email,password_hash,role) values($1,$2,$3) on conflict (email) do nothing',
      [u.email, hash, u.role]
    );
  }
}

ensureDemoUsers().catch(console.error);

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
}

app.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, error:'email and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await pool.query(
      'insert into users(email,password_hash,role) values($1,$2,$3) returning id,email,role',
      [email, hash, 'customer']
    );
    const token = signToken(user);
    res.json({ ok:true, token, user });
  } catch (e) {
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, error:'email and password required' });
  const { rows } = await pool.query('select id,email,password_hash,role from users where email=$1', [email]);
  if (rows.length === 0) return res.status(401).json({ ok:false, error:'invalid credentials' });
  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ ok:false, error:'invalid credentials' });
  const token = signToken(user);
  res.json({ ok:true, token, user: { id: user.id, email: user.email, role: user.role } });
});

app.get('/me', (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok:false, error:'missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ ok:true, user: payload });
  } catch (e) {
    res.status(401).json({ ok:false, error:'invalid token' });
  }
});

// --- Read endpoints for dashboard ---
// Summary counts by role + total
app.get('/users/summary', async (_req, res) => {
  try {
    const { rows: totalRows } = await pool.query('select count(*)::int as total from users');
    const total = totalRows[0]?.total || 0;
    const roles = ['manager','staff','customer'];
    const by_role = {};
    for (const r of roles) {
      const { rows } = await pool.query('select count(*)::int as c from users where role=$1', [r]);
      by_role[r] = rows[0]?.c || 0;
    }
    res.json({ ok:true, total, by_role });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Latest users (read-only, no passwords)
app.get('/users', async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  try {
    const { rows } = await pool.query('select id, email, role, created_at from users order by created_at desc limit $1', [limit]);
    res.json({ ok:true, users: rows });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});
