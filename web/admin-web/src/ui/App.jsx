import React, { useEffect, useMemo, useState } from 'react'
import { auth, health, inventory, menu, orders } from '../api'

function Panel({ title, children }){
  return (
    <div style={{ border:'1px solid #ddd', borderRadius:8, padding:12 }}>
      <div style={{ fontWeight:700, marginBottom:8 }}>{title}</div>
      {children}
    </div>
  )
}

function Row({ cols }){
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12 }}>
      {cols}
    </div>
  )
}

export default function App(){
  const [svc, setSvc] = useState({})
  const [ord, setOrd] = useState([])
  const [outbox, setOutbox] = useState(null)
  const [central, setCentral] = useState([])
  const [store, setStore] = useState([])
  const [catalog, setCatalog] = useState([])
  const [users, setUsers] = useState([])
  const [userSummary, setUserSummary] = useState(null)

  // Poll every 5s
  useEffect(() => {
    let alive = true
    async function tick(){
      try {
        const [ha, hm, ho, hi, hs] = await Promise.all([
          health.auth().catch(e=>({ ok:false, _ms:e.ms })),
          health.menu().catch(e=>({ ok:false, _ms:e.ms })),
          health.order().catch(e=>({ ok:false, _ms:e.ms })),
          health.inventory().catch(e=>({ ok:false, _ms:e.ms })),
          health.store().catch(e=>({ ok:false, _ms:e.ms })),
        ])
        if (!alive) return
        setSvc({
          auth: { ok: !!ha.ok, ms: Math.round(ha._ms||0) },
          menu: { ok: !!hm.ok, ms: Math.round(hm._ms||0) },
          order: { ok: !!ho.ok, ms: Math.round(ho._ms||0) },
          inventory: { ok: !!hi.ok, ms: Math.round(hi._ms||0) },
          store: { ok: !!hs.ok, ms: Math.round(hs._ms||0) },
        })
      } catch {}

      try {
        const [o, ob, c, s, m, us, ul] = await Promise.all([
          orders.recent(50).catch(()=>null),
          orders.outboxSummary().catch(()=>null),
          inventory.stock('central').catch(()=>null),
          inventory.stock('store-001').catch(()=>null),
          menu.list().catch(()=>null),
          auth.usersSummary().catch(()=>null),
          auth.users(50).catch(()=>null),
        ])
        if (!alive) return
        setOrd(o?.orders || [])
        setOutbox(ob)
        setCentral(c?.items || [])
        setStore(s?.items || [])
        setCatalog(m?.items || [])
        setUserSummary(us)
        setUsers(ul?.users || [])
      } catch {}
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const nameBySku = useMemo(() => {
    const map = new Map()
    for (const it of catalog) map.set(it.sku, it.name)
    return map
  }, [catalog])

  const stockRows = useMemo(() => {
    const bySku = new Map()
    for (const r of central) bySku.set(r.sku, { sku:r.sku, central:r.qty, store:0 })
    for (const r of store) {
      const cur = bySku.get(r.sku) || { sku:r.sku, central:0, store:0 }
      cur.store = r.qty
      bySku.set(r.sku, cur)
    }
    return Array.from(bySku.values()).sort((a,b)=>a.sku.localeCompare(b.sku))
  }, [central, store])

  return (
    <div style={{ fontFamily:'system-ui, Arial', padding:16, display:'grid', gap:12 }}>
      <h1>Admin Dashboard</h1>

      <Panel title="Services Status">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:8 }}>
          {['auth','menu','order','inventory','store'].map(k => (
            <div key={k} style={{ border:'1px solid #eee', borderRadius:6, padding:8 }}>
              <div style={{fontWeight:600, textTransform:'capitalize'}}>{k}</div>
              <div style={{ color: svc[k]?.ok ? '#155724' : '#721c24' }}>
                {svc[k]?.ok ? 'UP' : 'DOWN'}
              </div>
              <div style={{ fontSize:12, color:'#555' }}>{svc[k]?.ms ?? 0} ms</div>
            </div>
          ))}
        </div>
      </Panel>

      <Row cols={[
        <Panel key="orders" title="Recent Orders (central)">
          {ord.length === 0 ? <div>No orders</div> : (
            <div style={{ maxHeight:300, overflow:'auto' }}>
              <table width="100%" style={{ borderCollapse:'collapse' }}>
                <thead>
                  <tr><th align="left">ID</th><th align="left">Store</th><th>Status</th><th align="right">Total</th><th>Items</th><th align="left">Created</th></tr>
                </thead>
                <tbody>
                  {ord.map(o => (
                    <tr key={o.id}>
                      <td>{o.id.slice(0,8)}…</td>
                      <td>{o.store_id}</td>
                      <td>{o.status}</td>
                      <td align="right">${(o.total_cents/100).toFixed(2)}</td>
                      <td align="center">{o.items?.length||0}</td>
                      <td>{new Date(o.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>,
        <Panel key="outbox" title="Store Outbox Summary (via central)">
          {!outbox ? <div>Loading…</div> : (
            <div>
              <div>Undelivered: <b>{outbox.undelivered}</b></div>
              <div style={{ maxHeight:220, overflow:'auto', marginTop:8 }}>
                <table width="100%" style={{ borderCollapse:'collapse' }}>
                  <thead>
                    <tr><th>ID</th><th>Topic</th><th>Delivered</th><th>Error</th><th>Created</th></tr>
                  </thead>
                  <tbody>
                    {(outbox.last_10||[]).map(e => (
                      <tr key={e.id}>
                        <td>{e.id}</td>
                        <td>{e.topic}</td>
                        <td>{String(e.delivered)}</td>
                        <td style={{color:'#721c24'}}>{e.last_error||''}</td>
                        <td>{new Date(e.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>
      ]} />

      <Row cols={[
        <Panel key="inv" title="Inventory Compare (central vs store-001)">
          <div style={{ maxHeight:300, overflow:'auto' }}>
            <table width="100%" style={{ borderCollapse:'collapse' }}>
              <thead>
                <tr><th align="left">SKU</th><th align="left">Name</th><th align="right">Central</th><th align="right">Store</th><th align="right">Drift</th></tr>
              </thead>
              <tbody>
                {stockRows.map(r => (
                  <tr key={r.sku}>
                    <td>{r.sku}</td>
                    <td>{nameBySku.get(r.sku) || ''}</td>
                    <td align="right">{r.central}</td>
                    <td align="right">{r.store}</td>
                    <td align="right">{(r.central - r.store)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>,
        <Panel key="auth" title="Auth Users (summary + latest)">
          {!userSummary ? <div>Loading…</div> : (
            <div>
              <div style={{ display:'flex', gap:12 }}>
                <div>Total: <b>{userSummary.total}</b></div>
                <div>Managers: <b>{userSummary.by_role?.manager||0}</b></div>
                <div>Staff: <b>{userSummary.by_role?.staff||0}</b></div>
                <div>Customers: <b>{userSummary.by_role?.customer||0}</b></div>
              </div>
              <div style={{ maxHeight:220, overflow:'auto', marginTop:8 }}>
                <table width="100%" style={{ borderCollapse:'collapse' }}>
                  <thead>
                    <tr><th align="left">Email</th><th>Role</th><th align="left">Created</th></tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td>{u.email}</td>
                        <td>{u.role}</td>
                        <td>{new Date(u.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>
      ]} />
    </div>
  )
}

