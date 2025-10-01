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

async function jpost(url, body) {
  const t0 = performance.now();
  const res = await fetch(url, { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body||{}) });
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
  outboxSummary: () => jfetch(`${ORDER_BASE}/outbox/summary`),
  reports: (period='day', opts={}) => {
    const params = new URLSearchParams();
    if (period) params.set('period', period);
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    if (opts.days) params.set('days', String(opts.days));
    if (opts.weeks) params.set('weeks', String(opts.weeks));
    if (opts.months) params.set('months', String(opts.months));
    if (opts.groupBy === 'store') params.set('group_by', 'store');
    return jfetch(`${ORDER_BASE}/reports/sales?${params.toString()}`)
  }
};

export const inventory = {
  stock: (location='central') => jfetch(`${INV_BASE}/stock?location=${encodeURIComponent(location)}`),
  stores: () => jfetch(`${INV_BASE}/stores`),
  centralList: (search='', limit=100) => {
    const p = new URLSearchParams();
    if (search) p.set('search', search);
    if (limit) p.set('limit', String(limit));
    return jfetch(`${INV_BASE}/central/stock?${p.toString()}`)
  },
  centralCreate: (sku, qty) => jpost(`${INV_BASE}/central/sku`, { sku, qty }),
  centralSet: (sku, qty) => jpost(`${INV_BASE}/central/set`, { sku, qty }),
  centralAdjust: (sku, delta) => jpost(`${INV_BASE}/central/adjust`, { sku, delta }),
  centralSeedFromStore: (store_id='store-001') => jpost(`${INV_BASE}/central/seed-from-store`, { store_id }),
  movements: (params={}) => {
    const p = new URLSearchParams();
    if (params.sku) p.set('sku', params.sku);
    if (params.store_id) p.set('store_id', params.store_id);
    if (params.from) p.set('from', params.from);
    if (params.to) p.set('to', params.to);
    if (params.limit) p.set('limit', String(params.limit));
    if (params.offset) p.set('offset', String(params.offset));
    return jfetch(`${INV_BASE}/movements?${p.toString()}`)
  },
  issue: (sku, qty, store_id, note) => jpost(`${INV_BASE}/central/issue`, { sku, qty, store_id, note })
};

export const menu = {
  list: () => jfetch(`${MENU_BASE}/menu`)
};
