export const AUTH_BASE = 'http://localhost:3001';
export const MENU_BASE = 'http://localhost:3002';
export const ORDER_BASE = 'http://localhost:3003';
export const INV_BASE = 'http://localhost:3004';
export const STORE_BASE = 'http://localhost:3010'; // not used for reads, here for reference

async function jfetch(url) {
  const t0 = performance.now();
  const res = await fetch(url);
  const dt = performance.now() - t0;
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.ms = dt; err.body = text;
    throw err;
  }
  const data = await res.json();
  data._ms = dt;
  return data;
}

export const health = {
  auth: () => jfetch(`${AUTH_BASE}/health`),
  menu: () => jfetch(`${MENU_BASE}/health`),
  order: () => jfetch(`${ORDER_BASE}/health`),
  inventory: () => jfetch(`${INV_BASE}/health`),
  store: () => jfetch(`${STORE_BASE}/health`),
};

export const auth = {
  usersSummary: () => jfetch(`${AUTH_BASE}/users/summary`),
  users: (limit=50) => jfetch(`${AUTH_BASE}/users?limit=${limit}`)
};

export const orders = {
  recent: (limit=50) => jfetch(`${ORDER_BASE}/orders?limit=${limit}`),
  outboxSummary: () => jfetch(`${ORDER_BASE}/outbox/summary`)
};

export const inventory = {
  stock: (location='central') => jfetch(`${INV_BASE}/stock?location=${encodeURIComponent(location)}`)
};

export const menu = {
  list: () => jfetch(`${MENU_BASE}/menu`)
};

