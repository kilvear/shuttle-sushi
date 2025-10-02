import React, { useEffect, useMemo, useState } from 'react'
import { fetchMenu, createOrder, paySuccess, payFailure } from './api'
import { login, register, me } from './auth'

const currencyFmt = new Intl.NumberFormat('en-SG', { style:'currency', currency:'SGD' });
function currency(cents){ return currencyFmt.format((Number(cents||0))/100) }

// Theme tokens (salmon as primary)
const theme = {
  brandNavy: '#0F1B2D',
  navy600: '#243A5C',
  surface: '#FFFFFF',
  border: '#E6E8EE',
  text: '#0F172A',
  muted: '#475569',
  primary: '#FF6F61',
  primaryHover: '#F45B55',
  successBg: '#D1FAE5',
  successText: '#065F46',
  errorBg: '#FEE2E2',
  errorText: '#991B1B',
}

function categoryOfSku(sku=''){
  if (sku.startsWith('SUSHI-')) return 'Sushi'
  if (sku.startsWith('ROLL-')) return 'Rolls'
  if (sku.startsWith('SOUP-')) return 'Soup'
  if (sku.startsWith('DRINK-')) return 'Drinks'
  return 'All'
}

export default function App(){
  const [menu, setMenu] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cart, setCart] = useState({})
  const [placing, setPlacing] = useState(false)
  const [status, setStatus] = useState(null)
  const [user, setUser] = useState(null)
  const [cat, setCat] = useState('All')
  const [cartOpen, setCartOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  // Pull-to-refresh (mobile)
  const [pullStart, setPullStart] = useState(null)
  const [pullY, setPullY] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) me().then(r=>setUser(r.user)).catch(()=>localStorage.removeItem('token'))
  }, [])

  useEffect(() => {
    fetchMenu().then(setMenu).catch(e=>setError(e.message)).finally(()=>setLoading(false))
  }, [])

  const itemsInCart = useMemo(() => Object.values(cart), [cart])
  const total = useMemo(() => itemsInCart.reduce((s,i)=>s + i.price_cents*i.qty, 0), [itemsInCart])

  const filtered = useMemo(() => {
    if (cat==='All') return menu
    return menu.filter(it => categoryOfSku(it.sku) === cat)
  }, [menu, cat])

  function addToCart(it){
    if (!it.available) return
    setError(null); setStatus(null);
    setCart(prev => {
      const existing = prev[it.sku]
      const nextQty = (existing?.qty || 0) + 1
      return { ...prev, [it.sku]: { sku: it.sku, name: it.name, price_cents: it.price_cents, qty: nextQty } }
    })
  }
  function inc(sku){ setCart(p=>({ ...p, [sku]: { ...p[sku], qty:(p[sku]?.qty||0)+1 } })) }
  function dec(sku){ setCart(p=>{ const q=(p[sku]?.qty||0)-1; const n={...p}; if(q<=0) delete n[sku]; else n[sku]={...p[sku], qty:q}; return n }) }
  function removeFromCart(sku){ setCart(p=>{ const n={...p}; delete n[sku]; return n }) }
  function clearCart(){ setCart({}) }

  async function placeAnd(act){
    setPlacing(true); setError(null); setStatus(null)
    try {
      const payloadItems = itemsInCart.map(i => ({ sku: i.sku, qty: i.qty, price_cents: i.price_cents }))
      const { id } = await createOrder(payloadItems)
      if (act === 'success') {
        await paySuccess(id)
        setStatus(`Order ${id} paid successfully`)
        clearCart(); setCartOpen(false)
      } else {
        await payFailure(id)
        setStatus(`Payment failed. Order ${id} cancelled`)
      }
    } catch (e) {
      setError(e.message); setStatus(null)
    } finally { setPlacing(false) }
  }

  return (
    <div
      style={{ fontFamily: 'system-ui, Arial', background:'#F6F8FB', minHeight:'100vh', overflowX:'hidden' }}
      onTouchStart={(e)=>{
        if (window.scrollY <= 0 && !refreshing) {
          setPullStart(e.touches[0].clientY)
          setPullY(0)
        } else {
          setPullStart(null)
        }
      }}
      onTouchMove={(e)=>{
        if (pullStart != null) {
          const dy = Math.max(0, e.touches[0].clientY - pullStart)
          setPullY(Math.min(80, dy))
        }
      }}
      onTouchEnd={async ()=>{
        if (pullStart != null && pullY > 60 && !refreshing) {
          setRefreshing(true)
          try { const data = await fetchMenu(); setMenu(data); setError(null) }
          catch(e){ setError(e.message) }
          finally { setRefreshing(false) }
        }
        setPullStart(null); setPullY(0)
      }}
    >
      <HeaderBar user={user} onLogin={()=>setAuthOpen(true)} onLogout={()=>{localStorage.removeItem('token'); setUser(null)}} itemsCount={itemsInCart.length} onOpenCart={()=>setCartOpen(true)} />

      {status && <div style={{margin:'12px 16px', color: theme.successText, background: theme.successBg, padding:8, borderRadius:8}}>{status}</div>}
      {error && <div style={{margin:'12px 16px', color: theme.errorText, background: theme.errorBg, padding:8, borderRadius:8}}>Error: {error}</div>}

      {/* Pull-to-refresh indicator */}
      <div style={{ height: pullY, transition: pullStart ? 'none' : 'height 150ms ease', display:'flex', alignItems:'flex-end', justifyContent:'center', color: theme.muted }}>
        {pullY>0 && (<div style={{ fontSize:12, paddingBottom:6 }}>{refreshing ? 'Refreshing…' : (pullY>60 ? 'Release to refresh' : 'Pull to refresh')}</div>)}
      </div>

      {/* Category chips */}
      <div style={{ position:'sticky', top:56, zIndex:5, background:'#F6F8FB', padding:'8px 12px', borderBottom:`1px solid ${theme.border}` }}>
        <div style={{ display:'flex', gap:8, overflowX:'auto' }}>
          {['All','Sushi','Rolls','Soup','Drinks'].map(c => (
            <button key={c} onClick={()=>setCat(c)} style={{
              flex:'0 0 auto', padding:'6px 12px', borderRadius:16, border:`1px solid ${theme.border}`,
              background: c===cat ? theme.navy600 : '#F2F4F8', color: c===cat ? '#fff' : theme.navy600
            }}>{c}</button>
          ))}
        </div>
      </div>

      {/* Product list */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:12, padding:'12px 16px 80px' }}>
        {loading ? (
          Array.from({length:6}).map((_,i)=>(<div key={i} style={{height:88, border:`1px solid ${theme.border}`, borderRadius:12, background:'#FFF'}} />))
        ) : (
          filtered.map(it => (
            <ProductRow key={it.sku} item={it} onAdd={()=>addToCart(it)} />
          ))
        )}
      </div>

      {/* Footer brand block to fill the bottom visually */}
      <FooterBrand />

      {/* Spacer so footer content isn't hidden behind sticky cart bar */}
      {itemsInCart.length>0 && <div style={{ height:64 }} />}

      {/* Sticky cart bar */}
      {itemsInCart.length>0 && (
        <div style={{ position:'fixed', left:0, right:0, bottom:0, background:'#fff', borderTop:`1px solid ${theme.border}`, padding:'8px 12px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ color: theme.text }}>{itemsInCart.length} item{itemsInCart.length>1?'s':''} • Total {currency(total)}</div>
          <button onClick={()=>setCartOpen(true)} style={{ background:theme.primary, color:'#fff', border:'none', borderRadius:999, padding:'8px 16px' }}>View Cart</button>
        </div>
      )}

      {/* Cart bottom sheet */}
      {cartOpen && (
        <CartSheet onClose={()=>setCartOpen(false)} items={itemsInCart} inc={inc} dec={dec} removeItem={removeFromCart}
                   total={total} placing={placing} placeSuccess={()=>placeAnd('success')} placeFailure={()=>placeAnd('failure')} clearCart={clearCart} />
      )}

      {/* Auth modal */}
      {authOpen && (
        <AuthModal onClose={()=>setAuthOpen(false)} setUser={setUser} />
      )}
    </div>
  )}

function HeaderBar({ user, onLogin, onLogout, itemsCount, onOpenCart }){
  return (
    <div style={{ position:'sticky', top:0, zIndex:10, height:56, background: theme.brandNavy, color:'#fff', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 12px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <img src="/images/placeholders/logo.webp" alt="logo" style={{ height:32, width:32, objectFit:'cover', borderRadius:6 }} />
        <div style={{ fontWeight:700 }}>Shuttle Sushi</div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        {user && (
          <div title={user.email} style={{ maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', opacity:0.9 }}>
            Hi, <b>{user.email}</b>
          </div>
        )}
        {user ? (
          <button onClick={onLogout} style={{ background:'transparent', color:'#fff', border:'1px solid rgba(255,255,255,0.4)', borderRadius:8, padding:'6px 10px' }}>Logout</button>
        ) : (
          <button onClick={onLogin} style={{ background:'transparent', color:'#fff', border:'1px solid rgba(255,255,255,0.4)', borderRadius:8, padding:'6px 10px' }}>Login</button>
        )}
        <button onClick={onOpenCart} style={{ position:'relative', background:'#fff', color:theme.brandNavy, border:'none', borderRadius:999, padding:'6px 12px', fontWeight:600 }}>Cart
          {itemsCount>0 && <span style={{ position:'absolute', top:-6, right:-6, background:theme.primary, color:'#fff', borderRadius:999, padding:'2px 6px', fontSize:12 }}>{itemsCount}</span>}
        </button>
      </div>
    </div>
  )
}

function FooterBrand(){
  return (
    <div style={{ marginTop:12, padding:'48px 16px 48px',
                  background: theme.brandNavy,
                  backgroundImage: 'radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)',
                  backgroundSize: '16px 16px', color:'#fff', textAlign:'center' }}>
      <img src="/images/placeholders/logo.webp" alt="Shuttle Sushi" style={{ height:220, width:220, objectFit:'cover', borderRadius:12, boxShadow:'0 2px 6px rgba(0,0,0,0.4)' }} />
      <div style={{ marginTop:8, fontWeight:700 }}>Shuttle Sushi</div>
      <div style={{ opacity:0.85, fontSize:12 }}>Taste on a fast orbit</div>
    </div>
  )
}

function ProductRow({ item, onAdd }){
  const imgSrc = `/images/menu/${item.sku}.webp`
  return (
    <div style={{ display:'flex', gap:12, padding:12, background:'#fff', border:`1px solid ${theme.border}`, borderRadius:12, alignItems:'center' }}>
      <img src={imgSrc} alt={item.name} onError={(e)=>{ e.currentTarget.src='/images/placeholders/default.webp' }} style={{ width:72, height:72, objectFit:'cover', borderRadius:8, background:'#f2f2f2' }} />
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, color:theme.text }}>{item.name}</div>
        <div style={{ color:theme.text }}>{currency(item.price_cents)}</div>
      </div>
      {item.available ? (
        <button onClick={onAdd} style={{ background:theme.primary, color:'#fff', border:'none', borderRadius:12, padding:'8px 12px' }}>Add</button>
      ) : (
        <span style={{ background:'#EEF2F7', color:'#64748B', border:'1px solid #E5E7EB', borderRadius:12, padding:'6px 10px' }}>Out of stock</span>
      )}
    </div>
  )
}

function CartSheet({ onClose, items, inc, dec, removeItem, total, placing, placeSuccess, placeFailure, clearCart }){
  return (
    <div aria-modal style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:20 }} onClick={onClose}>
      <div role="dialog" style={{ position:'absolute', left:0, right:0, bottom:0, background:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, padding:12, maxHeight:'85vh', overflow:'auto' }} onClick={e=>e.stopPropagation()}>
        <div style={{ height:6, width:80, background:'#ddd', borderRadius:3, margin:'4px auto 8px' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontWeight:700 }}>Your Cart</div>
          <button onClick={onClose} style={{ background:'transparent', border:'none', color:theme.muted }}>Close</button>
        </div>
        {items.length===0 ? <div style={{ color:theme.muted, padding:8 }}>Your cart is empty</div> : (
          <div style={{ display:'grid', gap:8 }}>
            {items.map(i => (
              <div key={i.sku} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', border:`1px solid ${theme.border}`, borderRadius:10, padding:8 }}>
                <div>
                  <div style={{ fontWeight:600 }}>{i.name}</div>
                  <div style={{ color:theme.muted, fontSize:12 }}>{currency(i.price_cents)}</div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <button onClick={()=>dec(i.sku)} style={{ width:32, height:32, borderRadius:8, border:`1px solid ${theme.border}`, background:'#F2F4F8' }}>-</button>
                  <div style={{ minWidth:20, textAlign:'center' }}>{i.qty}</div>
                  <button onClick={()=>inc(i.sku)} style={{ width:32, height:32, borderRadius:8, border:`1px solid ${theme.border}`, background:'#F2F4F8' }}>+</button>
                </div>
                <div style={{ minWidth:80, textAlign:'right', fontWeight:600 }}>{currency(i.qty * i.price_cents)}</div>
                <button onClick={()=>removeItem(i.sku)} style={{ background:'transparent', color:theme.muted, border:'none' }}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ borderTop:`1px solid ${theme.border}`, marginTop:8, paddingTop:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontWeight:700 }}>Total</div>
          <div style={{ fontWeight:700 }}>{currency(total)}</div>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:8 }}>
          <button disabled={items.length===0 || placing} onClick={placeSuccess} style={{ flex:1, background:theme.primary, color:'#fff', border:'none', borderRadius:12, padding:'10px 12px' }}>{placing?'Processing…':'Pay Success'}</button>
          <button disabled={items.length===0 || placing} onClick={placeFailure} style={{ flex:1, background:'#fff', color:theme.primary, border:`1px solid ${theme.primary}`, borderRadius:12, padding:'10px 12px' }}>{placing?'Processing…':'Pay Failure'}</button>
        </div>
        <div style={{ marginTop:8 }}>
          <button onClick={clearCart} disabled={items.length===0} style={{ background:'transparent', border:'none', color:theme.muted }}>Clear cart</button>
        </div>
      </div>
    </div>
  )
}

function AuthModal({ onClose, setUser }){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  async function doLogin(){
    try { setErr(''); const r = await login(email, password); localStorage.setItem('token', r.token); setUser(r.user); onClose() } catch(e){ setErr(e.message) }
  }
  async function doRegister(){
    try { setErr(''); const r = await register(email, password); localStorage.setItem('token', r.token); setUser(r.user); onClose() } catch(e){ setErr(e.message) }
  }
  return (
    <div aria-modal style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:30 }} onClick={onClose}>
      <div role="dialog" style={{ position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)', width:'min(92vw, 420px)', background:'#fff', borderRadius:12, padding:16 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontWeight:700 }}>Sign in</div>
          <button onClick={onClose} style={{ background:'transparent', border:'none', color:theme.muted }}>Close</button>
        </div>
        {err && <div style={{ color:theme.errorText, background:theme.errorBg, padding:8, borderRadius:8, marginBottom:8 }}>{err}</div>}
        <div style={{ display:'grid', gap:8 }}>
          <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} style={{ padding:10, border:`1px solid ${theme.border}`, borderRadius:10 }} />
          <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} style={{ padding:10, border:`1px solid ${theme.border}`, borderRadius:10 }} />
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={doLogin} style={{ flex:1, background:theme.primary, color:'#fff', border:'none', borderRadius:10, padding:'10px 12px' }}>Login</button>
            <button onClick={doRegister} style={{ flex:1, background:'#fff', color:theme.primary, border:`1px solid ${theme.primary}`, borderRadius:10, padding:'10px 12px' }}>Register</button>
          </div>
        </div>
      </div>
    </div>
  )
}
