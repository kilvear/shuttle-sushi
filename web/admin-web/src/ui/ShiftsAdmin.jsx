import React, { useEffect, useMemo, useState } from 'react'
import { auth, inventory, schedule } from '../api'

export default function ShiftsAdmin(){
  const [stores, setStores] = useState(['store-001'])
  const [storeId, setStoreId] = useState('store-001')
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0,10))
  const [to, setTo] = useState(() => new Date(Date.now()+14*864e5).toISOString().slice(0,10))
  const [rows, setRows] = useState([])
  const [users, setUsers] = useState([])
  const [limit, setLimit] = useState(100)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [form, setForm] = useState({ date:'', start_time:'', end_time:'', role_required:'staff', note:'' })

  const timeOptions = useMemo(() => {
    const out = []
    for (let h=0; h<=22; h++) {
      for (let m=0; m<60; m+=15) {
        if (h===22 && m>0) break
        const hh = String(h).padStart(2,'0'); const mm = String(m).padStart(2,'0')
        out.push(`${hh}:${mm}`)
      }
    }
    return out
  }, [])

  const endOptions = useMemo(() => {
    if (!form.start_time) return timeOptions.slice(1)
    return timeOptions.filter(t => t > form.start_time)
  }, [form.start_time, timeOptions])

  useEffect(() => {
    let alive = true
    async function boot(){
      try {
        const [st, ul] = await Promise.all([
          inventory.stores().catch(()=>({ stores:['store-001'] })),
          auth.users(200).catch(()=>({ users:[] }))
        ])
        if (!alive) return
        setStores(st.stores || ['store-001'])
        setUsers(ul.users || [])
      } catch{}
    }
    boot()
  }, [])

  async function load(off=0){
    try {
      setLoading(true); setErr('')
      const r = await schedule.list({ store_id: storeId, from, to, limit, offset: off })
      setRows(r.items||[]); setOffset(off)
    } catch(e){ setErr(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load(0) }, [storeId, from, to, limit])

  async function createShift(){
    if (!form.date || !form.start_time || !form.end_time) return alert('date/start/end required')
    try { setLoading(true); await schedule.create({ store_id:storeId, ...form }); setForm({ date:'', start_time:'', end_time:'', role_required:'staff', note:'' }); await load(0) }
    catch(e){ alert(e.message) } finally { setLoading(false) }
  }

  return (
    <div style={{ display:'grid', gap:12 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <label>Store: <select value={storeId} onChange={e=>setStoreId(e.target.value)}>{stores.map(s=>(<option key={s} value={s}>{s}</option>))}</select></label>
        <label>From: <input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
        <label>To: <input type="date" value={to} onChange={e=>setTo(e.target.value)} /></label>
        <label>Show: <select value={limit} onChange={e=>setLimit(Number(e.target.value))}><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option></select></label>
        <button onClick={()=>load(0)} disabled={loading}>Refresh</button>
      </div>
      <div style={{ borderTop:'1px solid #eee', paddingTop:8 }}>
        <div style={{ fontWeight:600, marginBottom:6 }}>Create Shift</div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input type="date" value={form.date} onChange={e=>setForm(f=>({ ...f, date:e.target.value }))} />
          <select value={form.start_time} onChange={e=>setForm(f=>({ ...f, start_time:e.target.value, end_time: (f.end_time && f.end_time>e.target.value) ? f.end_time : '' }))}>
            <option value="">start…</option>
            {timeOptions.map(t => (<option key={t} value={t}>{t}</option>))}
          </select>
          <select value={form.end_time} onChange={e=>setForm(f=>({ ...f, end_time:e.target.value }))} disabled={!form.start_time}>
            <option value="">end…</option>
            {endOptions.map(t => (<option key={t} value={t}>{t}</option>))}
          </select>
          <select value={form.role_required} onChange={e=>setForm(f=>({ ...f, role_required:e.target.value }))}>
            <option value="staff">staff</option>
            <option value="manager">manager</option>
          </select>
          <input placeholder="note (optional)" value={form.note} onChange={e=>setForm(f=>({ ...f, note:e.target.value }))} style={{ minWidth:220 }} />
          <button onClick={createShift} disabled={loading}>Create</button>
        </div>
        {(form.date && form.date < new Date().toISOString().slice(0,10)) && (
          <div style={{ color:'#856404', background:'#fff3cd', padding:6, borderRadius:6, marginTop:6 }}>Warning: Selected date is in the past.</div>
        )}
      </div>
      {err && <div style={{ color:'crimson' }}>{err}</div>}
      {loading ? <div>Loading…</div> : (
        <div style={{ maxHeight:460, overflow:'auto' }}>
          <table width="100%" style={{ borderCollapse:'collapse' }}>
            <thead>
              <tr><th align="left">Date</th><th>Start</th><th>End</th><th>Role</th><th align="left">Assignees</th><th>Assign</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id}>
                  <td>{String(s.date).slice(0,10)}</td>
                  <td>{s.start_time}</td>
                  <td>{s.end_time}</td>
                  <td>{s.role_required}</td>
                  <td>
                    {(s.assignees||[]).length===0 ? (
                      <span style={{ color:'#6c757d' }}>—</span>
                    ) : (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                        {(s.assignees||[]).map(a => (
                          <span key={a.user_id} style={{ border:'1px solid #ddd', borderRadius:6, padding:'2px 6px' }}>
                            {a.email}
                            <button title="Remove" style={{ marginLeft:6 }} onClick={async ()=>{
                              try { await schedule.unassign(s.id, a.user_id); await load(offset) } catch(e){ alert(e.message) }
                            }}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <Assign users={users} role={s.role_required} onAssign={async (uid)=>{ try { await schedule.assign(s.id, uid); await load(offset) } catch(e){ alert(e.message) } }} />
                  </td>
                  <td>
                    <button onClick={async ()=>{ if (!confirm('Delete shift?')) return; try { await schedule.remove(s.id); await load(offset) } catch(e){ alert(e.message) } }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop:8 }}>
            <button onClick={()=>{ const no=Math.max(0, offset-limit); load(no) }} disabled={offset===0 || loading}>Prev</button>{' '}
            <button onClick={()=>{ const no=offset+limit; load(no) }} disabled={rows.length<limit || loading}>Next</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Assign({ users, role, onAssign }){
  const [uid, setUid] = useState('')
  const options = useMemo(() => users.filter(u => (role==='staff' ? (u.role==='staff'||u.role==='manager') : u.role==='manager')), [users, role])
  return (
    <span>
      <select value={uid} onChange={e=>setUid(e.target.value)}>
        <option value="">select user…</option>
        {options.map(u => (<option key={u.id} value={u.id}>{u.email} ({u.role})</option>))}
      </select>
      <button onClick={()=> uid && onAssign(uid)} disabled={!uid}>Add</button>
    </span>
  )
}
