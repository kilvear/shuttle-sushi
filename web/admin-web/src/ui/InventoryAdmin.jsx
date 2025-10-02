import React, { useEffect, useMemo, useState } from 'react'
import { inventory, menu, store } from '../api'

export default function InventoryAdmin(){
  const [view, setView] = useState('central') // 'central' | 'store' | 'compare' | 'movements'
  const [search, setSearch] = useState('')
  const [centralRows, setCentralRows] = useState([])
  const [mirrorRows, setMirrorRows] = useState([])
  const [liveRows, setLiveRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [newSku, setNewSku] = useState('')
  const [newQty, setNewQty] = useState('0')
  const [catalog, setCatalog] = useState([])
  const [hideZero, setHideZero] = useState(false)
  const [stores, setStores] = useState(['central','store-001'])
  const [selectedStore, setSelectedStore] = useState('central')
  // Pagination
  const [pageSize, setPageSize] = useState(100)
  const [centralPage, setCentralPage] = useState(0)
  const [storePage, setStorePage] = useState(0)
  // Movements
  const [movSku, setMovSku] = useState('')
  const [movStore, setMovStore] = useState('store-001')
  const [movLimit, setMovLimit] = useState(100)
  const [movOffset, setMovOffset] = useState(0)
  const [movRows, setMovRows] = useState([])
  const [issueSku, setIssueSku] = useState('')
  const [issueQty, setIssueQty] = useState('')
  const [issueStore, setIssueStore] = useState('store-001')
  const [issueNote, setIssueNote] = useState('')

  useEffect(() => {
    let alive = true
    async function tick(){
      try {
        const storeId = (selectedStore === 'central') ? 'store-001' : selectedStore
        const [storeIds, centralListRes, mirrorList, liveList, cat] = await Promise.all([
          inventory.stores().catch(()=>({ stores:['store-001']})),
          inventory.centralList(search, 200),
          inventory.stock(storeId).catch(()=>({ items: [] })),
          store.availability().catch(()=>({ items: [] })),
          menu.list().catch(()=>({ items: [] }))
        ])
        if (!alive) return
        // Merge central + discovered stores
        const storeOptions = Array.from(new Set(['central', ...(storeIds.stores || ['store-001'])]))
        setStores(storeOptions)
        setCentralRows(centralListRes.items || [])
        setMirrorRows(mirrorList.items || [])
        setLiveRows(liveList.items || [])
        setCatalog(cat.items || [])
      } catch (e) {
        if (!alive) return
        setErr(e.message)
      }
    }
    setLoading(true)
    tick().finally(()=>setLoading(false))
    return () => { alive = false }
  }, [search, selectedStore])

  // Load movements when tab or filters change
  useEffect(() => {
    if (view !== 'compare' && view !== 'store' && view !== 'central') return; // no-op
  }, [view])

  async function loadMovements(off=0){
    try {
      setLoading(true)
      const r = await inventory.movements({ sku: movSku, store_id: movStore || undefined, limit: movLimit, offset: off })
      setMovRows(r.items || [])
      setMovOffset(off)
    } catch(e){ setErr(e.message) }
    finally { setLoading(false) }
  }

  const nameBySku = useMemo(() => {
    const map = new Map()
    for (const it of catalog) map.set(it.sku, it.name)
    return map
  }, [catalog])

  // Central active map for dimming inactive SKUs across views
  const centralActive = useMemo(() => {
    const map = new Map()
    for (const r of centralRows) map.set(r.sku, r.is_active !== false)
    return map
  }, [centralRows])
  const rowStyle = (sku) => (centralActive.get(sku) === false ? { opacity: 0.6 } : undefined)

  async function doSet(sku){
    const v = prompt(`Set absolute qty for ${sku}`, '0')
    if (v == null) return
    const qty = Number(v)
    if (!Number.isFinite(qty) || qty < 0) return alert('Enter a non-negative number')
    try {
      setLoading(true)
      await inventory.centralSet(sku, qty)
      const list = await inventory.centralList(search, 200)
      setCentralRows(list.items||[])
    } catch(e){ alert(e.message) }
    finally { setLoading(false) }
  }

  async function doAdjust(sku){
    const v = prompt(`Adjust qty by delta (± <= 10000) for ${sku}`, '1')
    if (v == null) return
    const delta = Number(v)
    if (!Number.isFinite(delta)) return alert('Enter a number')
    if (Math.abs(delta) > 10000) return alert('Delta must be ≤ 10000 in magnitude')
    try {
      setLoading(true)
      await inventory.centralAdjust(sku, delta)
      const list = await inventory.centralList(search, 200)
      setCentralRows(list.items||[])
    } catch(e){ alert(e.message) }
    finally { setLoading(false) }
  }

  async function createSku(){
    const sku = newSku.trim()
    const qty = Number(newQty)
    if (!sku) return alert('SKU required')
    if (!Number.isFinite(qty) || qty < 0) return alert('Non-negative qty required')
    try {
      setLoading(true)
      await inventory.centralCreate(sku, qty)
      setNewSku(''); setNewQty('0')
      const list = await inventory.centralList(search, 200)
      setCentralRows(list.items||[])
    } catch(e){ alert(e.message) }
    finally { setLoading(false) }
  }

  // Filtered views based on search (store side is filtered client-side)
  const filteredCentral = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return centralRows
    return centralRows.filter(r => r.sku.toLowerCase().includes(s))
  }, [centralRows, search])

  const filteredMirror = useMemo(() => {
    const s = search.trim().toLowerCase()
    const arr = mirrorRows || []
    if (!s) return arr
    return arr.filter(r => r.sku.toLowerCase().includes(s))
  }, [mirrorRows, search])

  const filteredLive = useMemo(() => {
    const s = search.trim().toLowerCase()
    const arr = liveRows || []
    if (!s) return arr
    return arr.filter(r => r.sku.toLowerCase().includes(s))
  }, [liveRows, search])

  const compareRows = useMemo(() => {
    const map = new Map()
    // Left side: mirror for selected storeId
    for (const r of filteredMirror) map.set(r.sku, { sku:r.sku, mirror:r.qty, store:0 })
    // Right side: live store availability
    for (const r of filteredLive) {
      const cur = map.get(r.sku) || { sku:r.sku, mirror:0, store:0 }
      cur.store = r.qty
      map.set(r.sku, cur)
    }
    let list = Array.from(map.values()).map(x => ({ sku:x.sku, mirror:x.mirror||0, store:x.store||0, drift:(Number(x.mirror||0) - Number(x.store||0)) }))
    if (hideZero) list = list.filter(x => x.drift !== 0)
    return list.sort((a,b)=>a.sku.localeCompare(b.sku))
  }, [filteredMirror, filteredLive, hideZero])

  // SKU suggestions for usability (union of catalog + central + store)
  const skuOptions = useMemo(() => {
    const set = new Set()
    for (const it of catalog) if (it?.sku) set.add(it.sku)
    for (const r of centralRows) if (r?.sku) set.add(r.sku)
    for (const r of mirrorRows) if (r?.sku) set.add(r.sku)
    for (const r of liveRows) if (r?.sku) set.add(r.sku)
    return Array.from(set).sort()
  }, [catalog, centralRows, mirrorRows, liveRows])

  function downloadCSV(filename, rows) {
    const csv = rows.map(r => r.map(x => {
      if (x == null) return '';
      const s = String(x);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV(){
    const ts = new Date().toISOString().replace(/[:T]/g,'-').slice(0,16)
    if (view === 'central') {
      const rows = [['sku','name','qty_central']]
      for (const r of filteredCentral.slice(centralPage*pageSize, centralPage*pageSize + pageSize)) rows.push([r.sku, nameBySku.get(r.sku)||'', r.qty])
      return downloadCSV(`central_inventory_${ts}.csv`, rows)
    }
    if (view === 'store') {
      const rows = [['sku','name','qty_store']]
      const tableRows = (selectedStore==='central') ? filteredCentral : filteredMirror
      for (const r of tableRows.slice(storePage*pageSize, storePage*pageSize + pageSize)) rows.push([r.sku, nameBySku.get(r.sku)||'', r.qty])
      return downloadCSV(`store_inventory_${ts}.csv`, rows)
    }
    // compare (mirror vs live)
    const rows = [['sku','name','mirror_qty','store_qty','drift_mirror_minus_store']]
    for (const r of compareRows) rows.push([r.sku, nameBySku.get(r.sku)||'', r.mirror, r.store, r.drift])
    return downloadCSV(`inventory_compare_${ts}.csv`, rows)
  }

  return (
    <div style={{ display:'grid', gap:12 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <div>
          <button onClick={()=>setView('central')} disabled={view==='central'}>Central</button>{' '}
          <button onClick={()=>setView('store')} disabled={view==='store'}>Store</button>{' '}
          <button onClick={()=>setView('compare')} disabled={view==='compare'}>Compare</button>{' '}
          <button onClick={()=>{ setView('movements'); loadMovements(0); }} disabled={view==='movements'}>Movements</button>
        </div>
        <label>
          Store:{' '}
          <select value={selectedStore} onChange={e=>{ setSelectedStore(e.target.value); }}>
            {stores.map(s => (<option key={s} value={s}>{s}</option>))}
          </select>
        </label>
        <label>
          Search SKU: {" "}
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="e.g. SUSHI-" />
        </label>
        {view==='compare' && (
          <label style={{ marginLeft:8 }}>
            <input type="checkbox" checked={hideZero} onChange={e=>setHideZero(e.target.checked)} /> Hide zero drift
          </label>
        )}
        <label>
          Page size:{" "}
          <select value={pageSize} onChange={e=>{ setPageSize(Number(e.target.value)); setCentralPage(0); setStorePage(0); }}>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>
        <button onClick={exportCSV} disabled={loading}>Export CSV</button>
      </div>

      {view==='central' && (
        <>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <input placeholder="New SKU" value={newSku} onChange={e=>setNewSku(e.target.value)} />
            <input type="number" min={0} value={newQty} onChange={e=>setNewQty(e.target.value)} style={{ width:120 }} />
            <button onClick={createSku} disabled={loading}>Create SKU</button>
          </div>
          {loading ? <div>Loading…</div> : (
            <div style={{ maxHeight:420, overflow:'auto' }}>
              <table width="100%" style={{ borderCollapse:'collapse' }}>
                <thead>
                  <tr><th align="left">SKU</th><th align="left">Name</th><th align="right">Qty (central)</th><th align="center">Active</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filteredCentral.slice(centralPage*pageSize, centralPage*pageSize + pageSize).map(r => (
                    <tr key={r.sku} style={r.is_active === false ? { opacity: 0.6 } : undefined}>
                      <td>{r.sku}</td>
                      <td>{nameBySku.get(r.sku) || ''}</td>
                      <td align="right">{r.qty}</td>
                      <td align="center">
                        <input type="checkbox" checked={!!r.is_active} onChange={async (e)=>{
                          try {
                            await inventory.centralActive(r.sku, e.target.checked)
                            const list = await inventory.centralList(search, 200)
                            setCentralRows(list.items||[])
                          } catch(err){ alert(err.message) }
                        }} />
                      </td>
                      <td>
                        <button onClick={()=>doSet(r.sku)} disabled={loading}>Set</button>{' '}
                        <button onClick={()=>doAdjust(r.sku)} disabled={loading}>Adjust</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop:8 }}>
                <button onClick={()=>setCentralPage(p=>Math.max(0,p-1))} disabled={centralPage===0}>Prev</button>{' '}
                <button onClick={()=>setCentralPage(p=> (centralPage+1)*pageSize < filteredCentral.length ? p+1 : p)} disabled={(centralPage+1)*pageSize >= filteredCentral.length}>Next</button>
              </div>
            </div>
          )}
        </>
      )}

      {view==='store' && (
        loading ? <div>Loading…</div> : (
          <div style={{ maxHeight:420, overflow:'auto' }}>
            <table width="100%" style={{ borderCollapse:'collapse' }}>
              <thead>
                <tr><th align="left">SKU</th><th align="left">Name</th><th align="right">Qty ({selectedStore})</th></tr>
              </thead>
              <tbody>
                {(selectedStore==='central' ? filteredCentral : filteredMirror).slice(storePage*pageSize, storePage*pageSize + pageSize).map(r => (
                  <tr key={r.sku} style={rowStyle(r.sku)}>
                    <td>{r.sku}</td>
                    <td>{nameBySku.get(r.sku) || ''}</td>
                    <td align="right">{r.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop:8 }}>
              <button onClick={()=>setStorePage(p=>Math.max(0,p-1))} disabled={storePage===0}>Prev</button>{' '}
              <button onClick={()=>setStorePage(p=> (storePage+1)*pageSize < ((selectedStore==='central'?filteredCentral:filteredMirror).length) ? p+1 : p)} disabled={(storePage+1)*pageSize >= ((selectedStore==='central'?filteredCentral:filteredMirror).length)}>Next</button>
            </div>
          </div>
        )
      )}

      {view==='compare' && (
        loading ? <div>Loading…</div> : (
          <div style={{ maxHeight:420, overflow:'auto' }}>
            <div style={{ fontSize:12, color:'#555', margin:'4px 0 8px' }}>
              Comparing central store mirror vs store-live for <b>{(selectedStore==='central'?'store-001':selectedStore)}</b>. Drift = mirror − store. Inactive central SKUs are dimmed.
            </div>
            <table width="100%" style={{ borderCollapse:'collapse' }}>
              <thead>
                <tr><th align="left">SKU</th><th align="left">Name</th><th align="right">Mirror ({(selectedStore==='central'?'store-001':selectedStore)})</th><th align="right">Store Live</th><th align="right">Drift (mirror−store)</th></tr>
              </thead>
              <tbody>
                {compareRows.map(r => (
                  <tr key={r.sku} style={rowStyle(r.sku)}>
                    <td>{r.sku}</td>
                    <td>{nameBySku.get(r.sku) || ''}</td>
                    <td align="right">{r.mirror}</td>
                    <td align="right">{r.store}</td>
                    <td align="right">{r.drift}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {view==='movements' && (
        <div style={{ display:'grid', gap:8 }}>
          {/* Datalist for SKU suggestions */}
          <datalist id="skuOptions">
            {skuOptions.map(s => (<option key={s} value={s} />))}
          </datalist>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {/* <label>SKU: <input list="skuOptions" value={movSku} onChange={e=>setMovSku(e.target.value)} placeholder="e.g. ROLL-" /></label> */}
            <label>Store: <input value={movStore} onChange={e=>setMovStore(e.target.value)} placeholder="store-001" /></label>
            <label>Page size: <select value={movLimit} onChange={e=>{ setMovLimit(Number(e.target.value)); loadMovements(0); }}>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select></label>
            <button onClick={()=>loadMovements(0)} disabled={loading}>Refresh</button>
          </div>
          <div style={{ borderTop:'1px solid #eee', paddingTop:8 }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>Issue Stock</div>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <input placeholder="SKU" list="skuOptions" value={issueSku} onChange={e=>setIssueSku(e.target.value)} />
              <input type="number" min={1} placeholder="Qty" value={issueQty} onChange={e=>setIssueQty(e.target.value)} />
              <input placeholder="Store ID" value={issueStore} onChange={e=>setIssueStore(e.target.value)} />
              <input placeholder="Note (optional)" value={issueNote} onChange={e=>setIssueNote(e.target.value)} style={{ minWidth:220 }} />
              <button onClick={async ()=>{
                const qty = Number(issueQty)
                if (!issueSku.trim() || !issueStore.trim() || !Number.isFinite(qty) || qty <= 0) return alert('Enter SKU, positive qty, and store')
                try {
                  setLoading(true)
                  await inventory.issue(issueSku.trim(), qty, issueStore.trim(), issueNote.trim()||undefined)
                  // Refresh movements and central stock
                  await loadMovements(0)
                  const list = await inventory.centralList(search, 200)
                  setCentralRows(list.items||[])
                  setIssueSku(''); setIssueQty(''); setIssueNote('')
                } catch(e){ alert(e.message) }
                finally { setLoading(false) }
              }} disabled={loading}>Issue</button>
            </div>
          </div>
          <div style={{ maxHeight:420, overflow:'auto' }}>
            <table width="100%" style={{ borderCollapse:'collapse' }}>
              <thead>
                <tr><th align="left">Date</th><th>Type</th><th align="left">SKU</th><th align="right">Qty</th><th align="left">Source</th><th align="left">Dest</th><th align="left">Store</th><th align="left">Note</th></tr>
              </thead>
              <tbody>
                {movRows.map(m => (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at).toLocaleString()}</td>
                    <td>{m.movement_type}</td>
                    <td>{m.sku}</td>
                    <td align="right">{m.qty}</td>
                    <td>{m.source_location||''}</td>
                    <td>{m.dest_location||''}</td>
                    <td>{m.store_id||''}</td>
                    <td>{m.note||''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <button onClick={()=>{ const no = Math.max(0, movOffset - movLimit); loadMovements(no); }} disabled={movOffset===0 || loading}>Prev</button>{' '}
            <button onClick={()=>{ const no = movOffset + movLimit; loadMovements(no); }} disabled={movRows.length < movLimit || loading}>Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
