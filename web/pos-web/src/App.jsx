import React, { useEffect, useMemo, useState } from 'react'
import { fetchMenu, createOrder, paySuccess } from './api'
import { login, register, me } from './auth'

function currency(cents){ return `$${(cents/100).toFixed(2)}` }

export default function App(){
  const [menu, setMenu] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cart, setCart] = useState({}) // { sku: { sku, name, price_cents, qty } }
  const [placing, setPlacing] = useState(false)
  const [orderId, setOrderId] = useState(null)
  const [status, setStatus] = useState(null)
  const [user, setUser] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) me().then(r=>setUser(r.user)).catch(()=>localStorage.removeItem('token'))
  }, [])

  useEffect(() => {
    fetchMenu().then(setMenu).catch(e=>setError(e.message)).finally(()=>setLoading(false))
  }, [])

  const itemsInCart = useMemo(() => Object.values(cart), [cart])
  const total = useMemo(() => itemsInCart.reduce((s,i)=>s + i.price_cents*i.qty, 0), [itemsInCart])

  function addToCart(it){
    setError(null); setStatus(null);
    setCart(prev => {
      const existing = prev[it.sku]
      const nextQty = (existing?.qty || 0) + 1
      return { ...prev, [it.sku]: { sku: it.sku, name: it.name, price_cents: it.price_cents, qty: nextQty } }
    })
  }

  function removeFromCart(sku){
    setError(null); setStatus(null);
    setCart(prev => {
      const copy = { ...prev }
      delete copy[sku]
      return copy
    })
  }

  async function checkout(){
    setPlacing(true); setError(null); setStatus(null);
    try {
      const payloadItems = itemsInCart.map(i => ({ sku: i.sku, qty: i.qty, price_cents: i.price_cents }))
      const { id } = await createOrder(payloadItems)
      setOrderId(id)
      const res = await paySuccess(id)
      setStatus(`Order ${id} paid successfully`)
      setCart({})
    } catch (e) {
      if (e.status === 409) setStatus(`Out of stock. Try adjusting quantities.`)
      else setError(e.message)
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, Arial', padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1>POS</h1>
      <AuthBar user={user} setUser={setUser} setError={setError} />
      {loading && <p>Loading menu…</p>}
      {error && <p style={{color:'crimson'}}>Error: {error}</p>}
      {status && <p style={{color:'#155724', background:'#d4edda', padding:8, borderRadius:6}}>{status}</p>}

      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 2 }}>
          <h2>Menu</h2>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:12 }}>
            {menu.map(it => (
              <div key={it.sku} style={{ border:'1px solid #ddd', borderRadius:8, padding:12 }}>
                <div style={{fontWeight:600}}>{it.name}</div>
                <div>{currency(it.price_cents)}</div>
                <div style={{marginTop:8}}>
                  {it.available ? (
                    <button onClick={()=>addToCart(it)}>Add</button>
                  ) : (
                    <span style={{color:'gray'}}>Out of stock</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <h2>Cart</h2>
          {itemsInCart.length === 0 && <p>No items</p>}
          {itemsInCart.map(i => (
            <div key={i.sku} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #eee' }}>
              <div>
                <div>{i.name}</div>
                <div style={{fontSize:12, color:'#555'}}>x{i.qty} @ {currency(i.price_cents)}</div>
              </div>
              <div>
                <button onClick={()=>removeFromCart(i.sku)}>Remove</button>
              </div>
            </div>
          ))}
          <div style={{marginTop:12, fontWeight:600}}>Total: {currency(total)}</div>
          <div style={{marginTop:8}}>
            <button disabled={itemsInCart.length===0 || placing} onClick={checkout}>
              {placing ? 'Placing…' : 'Pay Success'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AuthBar({ user, setUser, setError }){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  async function doLogin(){
    try {
      setError(null)
      const r = await login(email, password)
      localStorage.setItem('token', r.token)
      setUser(r.user)
      setEmail(''); setPassword('')
    } catch(e){ setError(e.message) }
  }
  async function doRegister(){
    try {
      setError(null)
      const r = await register(email, password)
      localStorage.setItem('token', r.token)
      setUser(r.user)
      setEmail(''); setPassword('')
    } catch(e){ setError(e.message) }
  }
  function logout(){ localStorage.removeItem('token'); setUser(null); setError(null) }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
      {user ? (
        <>
          <span>Signed in: <b>{user.email}</b> ({user.role})</span>
          <button onClick={logout}>Logout</button>
        </>
      ) : (
        <>
          <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          <button onClick={doLogin}>Login</button>
          <button onClick={doRegister}>Register</button>
        </>
      )}
    </div>
  )
}
