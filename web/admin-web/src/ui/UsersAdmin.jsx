import React, { useEffect, useState } from 'react'
import { auth, health } from '../api'

export default function UsersAdmin(){
  const [users, setUsers] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [authUp, setAuthUp] = useState(true)
  const [limit, setLimit] = useState(50)
  const [search, setSearch] = useState('')
  const [createForm, setCreateForm] = useState({ email:'', password:'', role:'customer' })
  const [editUserId, setEditUserId] = useState(null)
  const [editForm, setEditForm] = useState({ email:'', password:'', role:'' })

  async function load(){
    setLoading(true); setError('')
    try {
      const [ha, su, ul] = await Promise.all([
        health.auth().catch(()=>({ ok:false })),
        auth.usersSummary().catch(()=>null),
        auth.users(limit).catch(()=>null),
      ])
      setAuthUp(!!ha.ok)
      setSummary(su)
      setUsers(ul?.users||[])
    } catch(e){ setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [limit])

  const filteredUsers = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u => (u.email||'').toLowerCase().includes(q));
  }, [users, search])

  async function doCreate(){
    try {
      setLoading(true); setError('')
      await auth.createUser(createForm.email.trim(), createForm.password, createForm.role)
      setCreateForm({ email:'', password:'', role:'customer' })
      await load()
    } catch(e){ setError(e.message.includes('Failed to fetch') ? 'Authentication service is unavailable. Please try again later.' : e.message) }
    finally { setLoading(false) }
  }

  async function doUpdate(){
    try {
      setLoading(true); setError('')
      const body = {}
      if (editForm.email) body.email = editForm.email
      if (editForm.role) body.role = editForm.role
      if (editForm.password) body.password = editForm.password
      await auth.updateUser(editUserId, body)
      setEditUserId(null); setEditForm({ email:'', password:'', role:'' })
      await load()
    } catch(e){ setError(e.message.includes('Failed to fetch') ? 'Authentication service is unavailable. Please try again later.' : e.message) }
    finally { setLoading(false) }
  }

  async function doDelete(id){
    if (!confirm('Delete this user?')) return
    try {
      setLoading(true); setError('')
      await auth.deleteUser(id)
      await load()
    } catch(e){ setError(e.message.includes('Failed to fetch') ? 'Authentication service is unavailable. Please try again later.' : e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display:'grid', gap:12 }}>
      
      {!authUp && (
        <div style={{color:'#0c5460', background:'#d1ecf1', padding:8, borderRadius:6}}>
          Authentication service unavailable. User management disabled.
        </div>
      )}
      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
        <label>Show last:
          <select value={limit} onChange={e=>setLimit(Number(e.target.value))} style={{ marginLeft:6 }}>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>
        <label>Search email: <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="e.g. staff" /></label>
      </div>
      {summary && (
        <div style={{ display:'flex', gap:12 }}>
          <div>Total: <b>{summary.total}</b></div>
          <div>Managers: <b>{summary.by_role?.manager||0}</b></div>
          <div>Staff: <b>{summary.by_role?.staff||0}</b></div>
          <div>Customers: <b>{summary.by_role?.customer||0}</b></div>
        </div>
      )}

      <div style={{ borderTop:'1px solid #eee', paddingTop:8 }}>
        <div style={{ fontWeight:600, marginBottom:6 }}>Create User</div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input placeholder="email" value={createForm.email} onChange={e=>setCreateForm(f=>({ ...f, email:e.target.value }))} />
          <input placeholder="password" type="password" value={createForm.password} onChange={e=>setCreateForm(f=>({ ...f, password:e.target.value }))} />
          <select value={createForm.role} onChange={e=>setCreateForm(f=>({ ...f, role:e.target.value }))}>
            <option value="customer">customer</option>
            <option value="staff">staff</option>
            <option value="manager">manager</option>
          </select>
          <button onClick={doCreate} disabled={loading || !authUp}>Create</button>
        </div>
      </div>

      <div style={{ borderTop:'1px solid #eee', paddingTop:8 }}>
        <div style={{ fontWeight:600, marginBottom:6 }}>Users</div>
        {error && <div style={{ color:'crimson' }}>{error}</div>}
        <div style={{ maxHeight:420, overflow:'auto' }}>
          <table width="100%" style={{ borderCollapse:'collapse' }}>
            <thead>
              <tr><th align="left">Email</th><th>Role</th><th align="left">Created</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{new Date(u.created_at).toLocaleString()}</td>
                  <td>
                    <button onClick={()=>{ setEditUserId(u.id); setEditForm({ email:u.email, password:'', role:u.role }) }} disabled={!authUp}>Edit</button>{' '}
                    <button onClick={()=>doDelete(u.id)} disabled={!authUp}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editUserId && (
        <div style={{ borderTop:'1px solid #eee', paddingTop:8 }}>
          <div style={{ fontWeight:600, marginBottom:6 }}>Edit User</div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <input placeholder="email" value={editForm.email} onChange={e=>setEditForm(f=>({ ...f, email:e.target.value }))} />
            <input placeholder="new password (optional)" type="password" value={editForm.password} onChange={e=>setEditForm(f=>({ ...f, password:e.target.value }))} />
            <select value={editForm.role} onChange={e=>setEditForm(f=>({ ...f, role:e.target.value }))}>
              <option value="customer">customer</option>
              <option value="staff">staff</option>
              <option value="manager">manager</option>
            </select>
            <button onClick={doUpdate} disabled={loading || !authUp}>Save</button>
            <button onClick={()=>{ setEditUserId(null); setEditForm({ email:'', password:'', role:'' }) }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
