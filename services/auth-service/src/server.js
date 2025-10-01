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
    await pool.query("select 1");
    // Ensure scheduling tables exist (idempotent)
    await pool.query(`
      create table if not exists shifts(
        id uuid primary key default gen_random_uuid(),
        store_id text not null default 'store-001',
        date date not null,
        start_time time not null,
        end_time time not null,
        role_required text not null default 'staff',
        note text,
        created_at timestamptz default now()
      );
    `);
    await pool.query(`
      create table if not exists shift_assignments(
        id uuid primary key default gen_random_uuid(),
        shift_id uuid references shifts(id) on delete cascade,
        user_id uuid references users(id) on delete cascade,
        created_at timestamptz default now(),
        unique(shift_id, user_id)
      );
    `);
    res.json({ ok: true, service: "auth-service" });
  }
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
    { email: 'bob@example.com', role: 'customer', password: 'password123' },
    { email: 'staff2@example.com', role: 'staff', password: 'password123' },
    { email: 'staff3@example.com', role: 'staff', password: 'password123' },
    { email: 'staff4@example.com', role: 'staff', password: 'password123' },
    { email: 'staff5@example.com', role: 'staff', password: 'password123' },
    { email: 'staff6@example.com', role: 'staff', password: 'password123' }
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

// --- Shifts scheduling (manager-only in UI; endpoints open for capstone) ---
function validateShiftInput(body){
  const { store_id='store-001', date, start_time, end_time, role_required='staff', note=null } = body || {};
  if (!date || !start_time || !end_time) return { error: 'date, start_time, end_time required' };
  // Simple same-day rule: end must be later than start
  // 15-minute increments enforcement
  function isQuarter(t){
    const [hh, mm] = String(t).split(':').map(Number); return Number.isFinite(hh)&&Number.isFinite(mm) && (mm%15===0);
  }
  if (!isQuarter(start_time) || !isQuarter(end_time)) return { error:'start_time and end_time must be at 15-minute intervals' };
  // Enforce operating hours: start and end must be <= 22:00:00 (10pm), same-day only
  if (!(start_time <= '22:00:00')) return { error:'start_time must be on or before 22:00' };
  if (!(end_time <= '22:00:00')) return { error:'end_time must be on or before 22:00' };
  return { store_id, date, start_time, end_time, role_required, note };
}

// List shifts with optional range and store
app.get('/shifts', async (req, res) => {
  const storeId = (req.query.store_id||'').toString().trim();
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  let limit = Number(req.query.limit || 100); if (!Number.isFinite(limit)) limit = 100; limit = Math.min(Math.max(limit, 1), 200);
  let offset = Number(req.query.offset || 0); if (!Number.isFinite(offset) || offset < 0) offset = 0;
  const where = [];
  const vals = [];
  let i = 1;
  if (storeId) { where.push(`store_id = $${i++}`); vals.push(storeId); }
  if (from && !isNaN(from)) { where.push(`date >= $${i++}`); vals.push(from.toISOString().slice(0,10)); }
  if (to && !isNaN(to)) { where.push(`date <= $${i++}`); vals.push(to.toISOString().slice(0,10)); }
  const whereSQL = where.length ? ('where ' + where.join(' and ')) : '';
  try {
    const { rows: shifts } = await pool.query(
      `select id, store_id, date, start_time, end_time, role_required, note, created_at
         from shifts ${whereSQL}
        order by date asc, start_time asc
        limit $${i++} offset $${i++}`,
      [...vals, limit, offset]
    );
    // Fetch assignments per batch
    const ids = shifts.map(s=>s.id);
    let assignments = [];
    if (ids.length){
      const { rows } = await pool.query(
        `select a.shift_id, a.user_id, u.email, u.role
           from shift_assignments a join users u on a.user_id=u.id
          where a.shift_id = any($1::uuid[])`, [ids]
      );
      assignments = rows;
    }
    const byShift = new Map();
    for (const r of assignments){
      if (!byShift.has(r.shift_id)) byShift.set(r.shift_id, []);
      byShift.get(r.shift_id).push({ user_id:r.user_id, email:r.email, role:r.role });
    }
    const out = shifts.map(s => ({ ...s, assignees: byShift.get(s.id)||[] }));
    res.json({ ok:true, items: out, next_offset: offset + shifts.length });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post('/shifts', async (req, res) => {
  const v = validateShiftInput(req.body);
  if (v.error) return res.status(400).json({ ok:false, error:v.error });
  const { store_id, date, start_time, end_time, role_required, note } = v;
  try {
    // same-day rule: end > start
    if (!(end_time > start_time)) return res.status(400).json({ ok:false, error:'end_time must be later than start_time (same-day shifts only)' });
    const { rows: [row] } = await pool.query(
      `insert into shifts(store_id, date, start_time, end_time, role_required, note)
       values($1,$2,$3,$4,$5,$6)
       returning id, store_id, date, start_time, end_time, role_required, note, created_at`,
      [store_id, date, start_time, end_time, role_required, note]
    );
    res.json({ ok:true, shift: row });
  } catch (e) {
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.patch('/shifts/:id', async (req, res) => {
  const id = req.params.id;
  const incoming = req.body || {};
  try {
    // Load existing to validate combined times
    const { rows: ex } = await pool.query('select store_id, date, start_time, end_time, role_required, note from shifts where id=$1', [id]);
    if (!ex.length) return res.status(404).json({ ok:false, error:'not found' });
    const prev = ex[0];
    const next = {
      store_id: incoming.store_id ?? prev.store_id,
      date: incoming.date ?? prev.date,
      start_time: incoming.start_time ?? prev.start_time,
      end_time: incoming.end_time ?? prev.end_time,
      role_required: incoming.role_required ?? prev.role_required,
      note: incoming.note ?? prev.note
    };
    // Enforce 15-min increments when time changes
    function isQuarter(t){ const [hh,mm]=String(t).split(':').map(Number); return Number.isFinite(hh)&&Number.isFinite(mm)&&(mm%15===0); }
    if ((incoming.start_time && !isQuarter(incoming.start_time)) || (incoming.end_time && !isQuarter(incoming.end_time))) {
      return res.status(400).json({ ok:false, error:'start_time and end_time must be at 15-minute intervals' });
    }
    // Same-day rule
    if (!(next.end_time > next.start_time)) return res.status(400).json({ ok:false, error:'end_time must be later than start_time (same-day shifts only)' });
    // Operating hours max 22:00
    if (!(next.start_time <= '22:00:00')) return res.status(400).json({ ok:false, error:'start_time must be on or before 22:00' });
    if (!(next.end_time <= '22:00:00')) return res.status(400).json({ ok:false, error:'end_time must be on or before 22:00' });
    // Build dynamic update
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(incoming)) {
      if (['store_id','date','start_time','end_time','role_required','note'].includes(k)) { sets.push(`${k}=$${i++}`); vals.push(v); }
    }
    if (!sets.length) return res.json({ ok:true, updated:0 });
    vals.push(id);
    const sql = `update shifts set ${sets.join(', ')} where id=$${i} returning id, store_id, date, start_time, end_time, role_required, note, created_at`;
    const { rows } = await pool.query(sql, vals);
    res.json({ ok:true, shift: rows[0] });
  } catch (e) {
    res.status(400).json({ ok:false, error:e.message });
  }
});

app.delete('/shifts/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const r = await pool.query('delete from shifts where id=$1', [id]);
    res.json({ ok:true, deleted: r.rowCount });
  } catch (e) {
    res.status(400).json({ ok:false, error:e.message });
  }
});

// Prevent overlapping assignments for the same user (same day)
app.post('/shifts/:id/assign', async (req, res) => {
  const shiftId = req.params.id;
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ ok:false, error:'user_id required' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: [s] } = await client.query('select store_id, date, start_time, end_time from shifts where id=$1 for update', [shiftId]);
    if (!s) { await client.query('rollback'); return res.status(404).json({ ok:false, error:'shift not found' }); }
    // Overlap if NOT (existing.end <= start OR existing.start >= end)
    const { rows: conflicts } = await client.query(
      `select a.id from shift_assignments a
         join shifts ss on a.shift_id = ss.id
        where a.user_id=$1 and ss.date=$2
          and not (ss.end_time <= $3 or ss.start_time >= $4)
          limit 1`, [user_id, s.date, s.start_time, s.end_time]
    );
    if (conflicts.length) { await client.query('rollback'); return res.status(409).json({ ok:false, error:'overlapping shift for user' }); }
    await client.query('insert into shift_assignments(shift_id, user_id) values($1,$2) on conflict do nothing', [shiftId, user_id]);
    await client.query('commit');
    res.json({ ok:true });
  } catch (e) {
    await client.query('rollback').catch(()=>{});
    res.status(400).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
});

app.delete('/shifts/:id/assign/:user_id', async (req, res) => {
  try {
    const r = await pool.query('delete from shift_assignments where shift_id=$1 and user_id=$2', [req.params.id, req.params.user_id]);
    res.json({ ok:true, deleted: r.rowCount });
  } catch (e) {
    res.status(400).json({ ok:false, error:e.message });
  }
});

// --- Administrative endpoints (simulated behind firewall; no auth enforced here) ---
// Create user
app.post('/users', async (req, res) => {
  const { email, password, role } = req.body || {};
  const roles = new Set(['manager','staff','customer']);
  if (!email || !password || !roles.has(role)) return res.status(400).json({ ok:false, error:'email, password and valid role required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await pool.query(
      'insert into users(email,password_hash,role) values($1,$2,$3) returning id,email,role,created_at',
      [email, hash, role]
    );
    res.json({ ok:true, user });
  } catch (e) {
    res.status(400).json({ ok:false, error:e.message });
  }
});

// Update user (email?, password?, role?)
app.patch('/users/:id', async (req, res) => {
  const id = req.params.id;
  const { email, password, role } = req.body || {};
  const roles = new Set(['manager','staff','customer']);
  if (role && !roles.has(role)) return res.status(400).json({ ok:false, error:'invalid role' });
  try {
    let hash = null;
    if (password) hash = await bcrypt.hash(password, 10);
    const sets = [];
    const vals = [];
    let i = 1;
    if (email) { sets.push(`email=$${i++}`); vals.push(email); }
    if (hash) { sets.push(`password_hash=$${i++}`); vals.push(hash); }
    if (role) { sets.push(`role=$${i++}`); vals.push(role); }
    if (sets.length === 0) return res.json({ ok:true, updated: 0 });
    vals.push(id);
    const sql = `update users set ${sets.join(', ') } where id=$${i} returning id,email,role,created_at`;
    const { rows } = await pool.query(sql, vals);
    if (rows.length === 0) return res.status(404).json({ ok:false, error:'not found' });
    res.json({ ok:true, user: rows[0] });
  } catch (e) {
    res.status(400).json({ ok:false, error:e.message });
  }
});

// Delete user
app.delete('/users/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const r = await pool.query('delete from users where id=$1', [id]);
    res.json({ ok:true, deleted: r.rowCount });
  } catch (e) {
    res.status(400).json({ ok:false, error:e.message });
  }
});
