import React, { useEffect, useMemo, useState } from 'react'
import { fetchMenu, createOrder, paySuccess, payFailure } from './api'

function currency(cents){ return `$${(cents/100).toFixed(2)}` }

export default function App(){
  const [menu, setMenu] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cart, setCart] = useState({})
  const [placing, setPlacing] = useState(false)
  const [orderId, setOrderId] = useState(null)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    fetchMenu().then(setMenu).catch(e=>setError(e.message)).finally(()=>setLoading(false))
  }, [])

  const itemsInCart = useMemo(() => Object.values(cart), [cart])
  const total = useMemo(() => itemsInCart.reduce((s,i)=>s + i.price_cents*i.qty, 0), [itemsInCart])

  function addToCart(it){
    if (!it.available) return // cannot add if unavailable
    setCart(prev => {
      const existing = prev[it.sku]
      const nextQty = (existing?.qty || 0) + 1
      return { ...prev, [it.sku]: { sku: it.sku, name: it.name, price_cents: it.price_cents, qty: nextQty } }
    })
  }

  function removeFromCart(sku){
    setCart(prev => { const c={...prev}; delete c[sku]; return c })
  }

  async function placeAnd(act){
    setPlacing(true); setError(null); setStatus(null)
    try {
      const payloadItems = itemsInCart.map(i => ({ sku: i.sku, qty: i.qty, price_cents: i.price_cents }))
      const { id } = await createOrder(payloadItems)
      setOrderId(id)
      const res = await (act === 'success' ? paySuccess(id) : payFailure(id))
      setStatus(`Order ${id} ${res.status}`)
      if (act === 'success') setCart({})
    } catch (e) {
      setError(e.message)
    } finally { setPlacing(false) }
  }

  return (
    <div style={{ fontFamily: 'system-ui, Arial', padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1>Customer Ordering</h1>
      <p style={{color:'#666'}}>Items may show as out of stock when unavailable.</p>
      {loading && <p>Loading…</p>}
      {error && <p style={{color:'crimson'}}>Error: {error}</p>}
      {status && <p style={{color:'#155724', background:'#d4edda', padding:8, borderRadius:6}}>{status}</p>}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:12 }}>
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

      <h2 style={{marginTop:24}}>Cart</h2>
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
        <button disabled={itemsInCart.length===0 || placing} onClick={()=>placeAnd('success')}>
          {placing ? 'Processing…' : 'Pay Success'}
        </button>
        <button disabled={itemsInCart.length===0 || placing} onClick={()=>placeAnd('failure')}>
          {placing ? 'Processing…' : 'Pay Failure'}
        </button>
      </div>
    </div>
  )
}

