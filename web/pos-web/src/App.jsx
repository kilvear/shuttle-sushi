import React, { useEffect, useMemo, useState } from 'react'
import { fetchMenu, createOrder, paySuccess, refundOrder, fetchRecentOrders, fetchAvailability, setStock, adjustStock, cancelOrder, fetchItems, createItem, updateItem } from './api'
import { login, register, me } from './auth'

const currencyFmt = new Intl.NumberFormat('en-SG', { style:'currency', currency:'SGD' });
function currency(cents){ return currencyFmt.format((Number(cents||0))/100) }

export default function App(){
  const [menu, setMenu] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cart, setCart] = useState({}) // { sku: { sku, name, price_cents, qty } }
  const [placing, setPlacing] = useState(false)
  const [orderId, setOrderId] = useState(null)
  const [status, setStatus] = useState(null)
  const [user, setUser] = useState(null)
  const [refundId, setRefundId] = useState('')
  const [recent, setRecent] = useState([])
  const [stock, setStockList] = useState([])
  const [items, setItems] = useState([])
  const [editSku, setEditSku] = useState('')
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [setInputs, setSetInputs] = useState({}) // { sku: qty }
  const [offline, setOffline] = useState(false)
  const [showShifts, setShowShifts] = useState(false)
  const [shifts, setShifts] = useState([])

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) me().then(r=>setUser(r.user)).catch(()=>localStorage.removeItem('token'))
  }, [])

  useEffect(() => {
    fetchMenu().then(setMenu).catch(e=>setError(e.message)).finally(()=>setLoading(false))
  }, [])

  useEffect(() => {
    let alive = true
    async function tick(){
      try {
        const r = await fetchRecentOrders(50)
        if (alive) setRecent(r.orders || [])
      } catch {}
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => { alive=false; clearInterval(id) }
  }, [])

  // Detect auth availability to enable Offline Sales Mode
  useEffect(() => {
    let alive = true
    async function ping(){
      try {
        const r = await fetch('http://localhost:3001/health')
        const ok = r.ok && (await r.json().catch(()=>({ok:false}))).ok
        if (alive) setOffline(!ok)
      } catch {
        if (alive) setOffline(true)
      }
    }
    ping()
    const id = setInterval(ping, 5000)
    return () => { alive=false; clearInterval(id) }
  }, [])

  useEffect(() => {
    let alive = true
    async function tick(){
      try {
        const r = await fetchAvailability()
        if (alive) setStockList(r.items || [])
      } catch {}
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => { alive=false; clearInterval(id) }
  }, [])

  useEffect(() => {
    let alive = true
    async function tick(){
      try { const r = await fetchItems(); if (alive) setItems(r.items||[]) } catch {}
    }
    tick(); const id = setInterval(tick, 10000)
    return () => { alive=false; clearInterval(id) }
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

  const canUsePOS = !!user && (user.role === 'staff' || user.role === 'manager')
  const canSell = offline || canUsePOS

  return (
    <div style={{ fontFamily: 'system-ui, Arial', padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1>POS</h1>
      {offline ? (
        <div style={{color:'#0c5460', background:'#d1ecf1', padding:8, borderRadius:6, marginBottom:12}}>
          Offline Sales Mode: auth unavailable. Sales only; refunds/inventory disabled.
        </div>
      ) : (
        <AuthBar user={user} setUser={setUser} setError={setError} />
      )}
      {!offline && !user && (
        <p style={{color:'#856404', background:'#fff3cd', padding:8, borderRadius:6}}>Please sign in to operate the POS.</p>
      )}
      {!offline && user && !canUsePOS && (
        <p style={{color:'#721c24', background:'#f8d7da', padding:8, borderRadius:6}}>Insufficient role. POS requires staff or manager.</p>
      )}
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
                    <button disabled={!canSell} onClick={()=> canSell && addToCart(it)}>
                      {canSell ? 'Add' : 'Add (login required)'}
                    </button>
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
          <div style={{marginTop:8, display:'flex', gap:8}}>
            <button disabled={!canSell || itemsInCart.length===0 || placing} onClick={checkout}>
              {placing ? 'Placing…' : 'Pay Success'}
            </button>
            <button disabled={itemsInCart.length===0} onClick={()=>setCart({})}>Clear cart</button>
          </div>
        </div>
      </div>

      {user && (
        <div style={{ marginTop:24 }}>
          <h2>Shifts</h2>
          <button onClick={async ()=>{
            if (!showShifts) {
              try {
                const from = new Date().toISOString().slice(0,10)
                const to = new Date(Date.now()+14*864e5).toISOString().slice(0,10)
                const r = await fetch(`http://localhost:3001/shifts?store_id=store-001&from=${from}&to=${to}&limit=100`)
                if (r.ok) { const d = await r.json(); setShifts((d.items||[]).filter(s => (s.assignees||[]).some(a=>a.user_id===user.sub))) }
              } catch {}
            }
            setShowShifts(s=>!s)
          }}>{showShifts ? 'Hide' : 'View'} My Shifts (14 days)</button>
          {showShifts && (
            <div style={{ maxHeight:260, overflow:'auto', border:'1px solid #eee', borderRadius:6, marginTop:8 }}>
              <table width="100%" style={{ borderCollapse:'collapse' }}>
                <thead><tr><th align="left">Date</th><th>Start</th><th>End</th></tr></thead>
                <tbody>
                  {shifts.map(s => (
                    <tr key={s.id}><td>{new Date(s.date).toLocaleDateString()}</td><td>{s.start_time}</td><td>{s.end_time}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(!offline && canUsePOS) && (
        <div style={{ marginTop:24 }}>
          <h2>Inventory (Store 1)</h2>
          {user?.role==='manager' && (
            <div style={{ border:'1px solid #eee', borderRadius:6, padding:8, marginBottom:12 }}>
              <div style={{ fontWeight:600, marginBottom:6 }}>Create SKU (Manager)</div>
              <CreateItemForm onCreate={async (sku,name,price)=>{ try{ await createItem(sku,name,price,true); const [a,b]=await Promise.all([fetchAvailability(), fetchItems()]); setStockList(a.items||[]); setItems(b.items||[]) } catch(e){ setError(e.message) } }} />
            </div>
          )}
          <div style={{ maxHeight:260, overflow:'auto', border:'1px solid #eee', borderRadius:6, marginBottom:12 }}>
            <table width="100%" style={{ borderCollapse:'collapse' }}>
              <thead>
                <tr><th align="left">SKU</th><th align="left">Name</th><th align="right">Qty</th><th>Adjust</th><th>Set</th>{user?.role==='manager' && (<th>Manage</th>)}</tr>
              </thead>
              <tbody>
                {stock.map(s => {
                  const it = items.find(i=>i.sku===s.sku)
                  const isEditing = editSku === s.sku
                  return (
                    <tr key={s.sku}>
                      <td>{s.sku}</td>
                      <td>{it?.name || ''}</td>
                      <td align="right">{s.qty}</td>
                      <td align="center">
                        <button onClick={async()=>{ setError(null); setStatus(null); try { await adjustStock(s.sku, -1); const r=await fetchAvailability(); setStockList(r.items||[]) } catch(e){ setError(e.message) } }}>-1</button>
                        <span style={{display:'inline-block', width:6}} />
                        <button onClick={async()=>{ setError(null); setStatus(null); try { await adjustStock(s.sku, +1); const r=await fetchAvailability(); setStockList(r.items||[]) } catch(e){ setError(e.message) } }}>+1</button>
                      </td>
                      <td align="center">
                        <input style={{width:80}} type="number" value={setInputs[s.sku] ?? ''} onChange={e=>setSetInputs(prev=>({ ...prev, [s.sku]: e.target.value }))} placeholder="qty" />
                        <span style={{display:'inline-block', width:6}} />
                        <button onClick={async()=>{
                          setError(null); setStatus(null);
                          const v = Number(setInputs[s.sku])
                          if (!Number.isFinite(v)) { setError('Enter a number'); return }
                          try { await setStock(s.sku, v); const r=await fetchAvailability(); setStockList(r.items||[]); setSetInputs(prev=>({ ...prev, [s.sku]: '' })) } catch(e){ setError(e.message) }
                        }}>Set</button>
                      </td>
                      {user?.role==='manager' && (
                        <td>
                          {!isEditing ? (
                            <button onClick={()=>{ setEditSku(s.sku); setEditName(it?.name||''); setEditPrice(String(it?.price_cents??'')); setEditActive(!!(it?.is_active ?? true)); }}>Edit</button>
                          ) : (
                            <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                              <input placeholder="Name" value={editName} onChange={e=>setEditName(e.target.value)} style={{ width:140 }} />
                              <input placeholder="Price (cents)" type="number" value={editPrice} onChange={e=>setEditPrice(e.target.value)} style={{ width:120 }} />
                              <label style={{ fontSize:12 }}><input type="checkbox" checked={editActive} onChange={e=>setEditActive(e.target.checked)} /> Active</label>
                              <button onClick={async ()=>{
                                setError(null); setStatus(null)
                                // client validation mirrors server
                                const name = editName.trim()
                                const price = Number(editPrice)
                                if (!name || name.length>60 || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/.test(name)) { setError('Invalid name'); return }
                                if (!Number.isInteger(price) || price<0 || price>500000) { setError('Invalid price'); return }
                                try {
                                  await updateItem(s.sku, { name, price_cents: price, is_active: editActive })
                                  const [a,b] = await Promise.all([fetchAvailability(), fetchItems()])
                                  setStockList(a.items||[]); setItems(b.items||[])
                                  setStatus('Item updated')
                                  setEditSku('')
                                } catch(e){ setError(e.message) }
                              }}>Save</button>
                              <button onClick={()=>{ setEditSku(''); setEditName(''); setEditPrice(''); }}>Cancel</button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Removed legacy Add/Set SKU block to avoid creating stock without catalog
              Creation should go via the manager-only Create SKU form above */}
          <h2>Transactions</h2>
          <div style={{ maxHeight:260, overflow:'auto', border:'1px solid #eee', borderRadius:6, marginBottom:12 }}>
            <table width="100%" style={{ borderCollapse:'collapse' }}>
              <thead>
                <tr><th align="left">ID</th><th>Status</th><th align="right">Items</th><th align="right">Total</th><th align="left">Created</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {recent.map(o => (
                  <tr key={o.id}>
                    <td>{o.id.slice(0,8)}…</td>
                    <td>{o.status}</td>
                    <td align="right">{o.item_count}</td>
                    <td align="right">${(o.total_cents/100).toFixed(2)}</td>
                    <td>{new Date(o.created_at).toLocaleString()}</td>
                    <td align="center" style={{ display:'flex', gap:8 }}>
                      {!offline && user?.role === 'manager' && o.status === 'PAID' && (
                        <button onClick={async ()=>{
                          setError(null); setStatus(null);
                          try { await refundOrder(o.id); setStatus(`Order ${o.id.slice(0,8)} refunded`) } catch(e){ setError(e.message) }
                        }}>Refund</button>
                      )}
                      {!offline && canUsePOS && o.status === 'PENDING' && (
                        <button onClick={async ()=>{
                          setError(null); setStatus(null);
                          try { await cancelOrder(o.id); setStatus(`Order ${o.id.slice(0,8)} cancelled`) } catch(e){ setError(e.message) }
                        }}>Cancel</button>
                      )}
                      {!((!offline && user?.role === 'manager' && o.status==='PAID') || (!offline && canUsePOS && o.status==='PENDING')) && (
                        <span style={{color:'#6c757d'}}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!offline && <h3>Manager Actions</h3>}
          {!offline && user?.role !== 'manager' ? (
            <p style={{color:'#6c757d'}}>Login as manager to refund orders.</p>
          ) : (!offline && (
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input placeholder="Order ID" value={refundId} onChange={e=>setRefundId(e.target.value)} style={{ flex:1 }} />
              <button onClick={async ()=>{
                setError(null); setStatus(null);
                try {
                  const r = await refundOrder(refundId.trim());
                  setStatus(`Order ${refundId} refunded`);
                  setRefundId('');
                } catch(e){ setError(e.message) }
              }}>Refund Order</button>
            </div>
          ))}
        </div>
      )}
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

function CreateItemForm({ onCreate }){
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
      <input placeholder="SKU (e.g. DRINK-GREENTEA)" value={sku} onChange={e=>setSku(e.target.value)} />
      <input placeholder="Name" value={name} onChange={e=>setName(e.target.value)} />
      <input placeholder="Price (cents)" type="number" value={price} onChange={e=>setPrice(e.target.value)} style={{ width:140 }} />
      <button onClick={()=>{ const p = Number(price); if(!sku||!name||!Number.isInteger(p)||p<0){ return; } onCreate(sku.trim(), name.trim(), p); setSku(''); setName(''); setPrice('') }}>Create</button>
    </div>
  )
}
