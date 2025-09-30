export const MENU_URL = 'http://localhost:3002/menu';
export const STORE_BASE = 'http://localhost:3010';

export async function fetchMenu() {
  const r = await fetch(MENU_URL);
  if (!r.ok) throw new Error('Failed to fetch menu');
  const data = await r.json();
  return data.items || [];
}

export async function createOrder(items) {
  const r = await fetch(`${STORE_BASE}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items })
  });
  if (!r.ok) throw new Error('Failed to create order');
  return r.json();
}

export async function paySuccess(orderId) {
  const r = await fetch(`${STORE_BASE}/orders/${orderId}/pay-success`, { method: 'POST' });
  if (!r.ok) {
    const err = await r.json().catch(()=>({error:'Unknown error'}));
    const e = new Error(err.error || 'Payment failed');
    e.status = r.status;
    throw e;
  }
  return r.json();
}

export async function getOrder(orderId) {
  const r = await fetch(`${STORE_BASE}/orders/${orderId}`);
  if (!r.ok) throw new Error('Failed to get order');
  return r.json();
}

