export const AUTH_BASE = 'http://localhost:3001';

export async function login(email, password){
  const r = await fetch(`${AUTH_BASE}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!r.ok) throw new Error('Login failed');
  return r.json();
}

export async function register(email, password){
  const r = await fetch(`${AUTH_BASE}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!r.ok) throw new Error('Register failed');
  return r.json();
}

export async function me(){
  const token = localStorage.getItem('token');
  if (!token) throw new Error('No token');
  const r = await fetch(`${AUTH_BASE}/me`, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!r.ok) throw new Error('Invalid token');
  return r.json();
}

