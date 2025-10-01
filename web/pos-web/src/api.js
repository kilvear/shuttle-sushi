export const MENU_URL = 'http://localhost:3002/menu';
export const STORE_BASE = 'http://localhost:3010';

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export async function fetchMenu() {
  const r = await fetch(MENU_URL, { headers: { ...authHeaders() } });
  if (!r.ok) throw new Error('Failed to fetch menu');
  const data = await r.json();
  return data.items || [];
}

export async function createOrder(items) {
  const r = await fetch(`${STORE_BASE}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ items })
  });
  if (!r.ok) throw new Error('Failed to create order');
  return r.json();
}

export async function paySuccess(orderId) {
  const r = await fetch(`${STORE_BASE}/orders/${orderId}/pay-success`, { method: 'POST', headers: { ...authHeaders() } });
  if (!r.ok) {
    const err = await r.json().catch(()=>({error:'Unknown error'}));
    const e = new Error(err.error || 'Payment failed');
    e.status = r.status;
    throw e;
  }
  return r.json();
}

export async function getOrder(orderId) {
  const r = await fetch(`${STORE_BASE}/orders/${orderId}`, { headers: { ...authHeaders() } });
  if (!r.ok) throw new Error('Failed to get order');
  return r.json();
}

export async function refundOrder(orderId) {
  const r = await fetch(`${STORE_BASE}/orders/${orderId}/refund`, { method: 'POST', headers: { ...authHeaders() } });
  if (!r.ok) {
    const err = await r.json().catch(()=>({error:'Refund failed'}));
    const e = new Error(err.error || 'Refund failed');
    e.status = r.status; throw e;
  }
  return r.json();
}

export async function fetchRecentOrders(limit=50){
  const r = await fetch(`${STORE_BASE}/orders/recent?limit=${limit}`, { headers: { ...authHeaders() } });
  if (!r.ok) throw new Error('Failed to load recent orders');
  return r.json();
}

// Inventory APIs
export async function fetchAvailability(){
  const r = await fetch(`${STORE_BASE}/availability`, { headers: { ...authHeaders() } });
  if (!r.ok) throw new Error('Failed to load availability');
  return r.json();
}

// Catalog APIs (manager-only for writes)
export async function fetchItems(){
  const r = await fetch(`${STORE_BASE}/items`, { headers: { ...authHeaders() } });
  if (!r.ok) throw new Error('Failed to load items');
  return r.json();
}

export async function createItem(sku, name, price_cents, is_active=true){
  const r = await fetch(`${STORE_BASE}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sku, name, price_cents, is_active })
  });
  if (!r.ok) { const e = await r.json().catch(()=>({error:'Create item failed'})); throw new Error(e.error||'Create item failed'); }
  return r.json();
}

export async function updateItem(sku, body){
  const r = await fetch(`${STORE_BASE}/items/${encodeURIComponent(sku)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body||{})
  });
  if (!r.ok) { const e = await r.json().catch(()=>({error:'Update item failed'})); throw new Error(e.error||'Update item failed'); }
  return r.json();
}

export async function setStock(sku, qty){
  const r = await fetch(`${STORE_BASE}/inventory/set`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sku, qty })
  });
  if (!r.ok) {
    const err = await r.json().catch(()=>({error:'Set stock failed'}));
    throw new Error(err.error || 'Set stock failed');
  }
  return r.json();
}

export async function adjustStock(sku, delta){
  const r = await fetch(`${STORE_BASE}/inventory/adjust`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sku, delta })
  });
  if (!r.ok) {
    const err = await r.json().catch(()=>({error:'Adjust stock failed'}));
    throw new Error(err.error || 'Adjust stock failed');
  }
  return r.json();
}

export async function cancelOrder(orderId){
  const r = await fetch(`${STORE_BASE}/orders/${orderId}/pay-failure`, { method: 'POST', headers: { ...authHeaders() } });
  if (!r.ok) {
    const err = await r.json().catch(()=>({error:'Cancel failed'}));
    const e = new Error(err.error || 'Cancel failed');
    e.status = r.status; throw e;
  }
  return r.json();
}
