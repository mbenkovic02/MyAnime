(async function(){
  // provjera usera je li admin
  try{
    const me = await fetch('/api/user').then(r=>r.json());
    if(!me || me.role !== 'admin'){
      location.href = 'index.html';
      return;
    }
  }catch(e){
    location.href = 'index.html';
    return;
  }

  const tbody = document.getElementById('tbody');
  const errorEl = document.getElementById('error');

  // ucitavanje liste usera
  async function loadUsers(){
    errorEl.textContent = '';
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
    try{
      const rows = await fetch('/api/admin/users').then(r=>r.json());
      if(!Array.isArray(rows)) throw new Error('Unexpected response');
      tbody.innerHTML = rows.map(u => `
        <tr data-id="${u.id}">
          <td>${u.id}</td>
          <td>${u.first_name} ${u.last_name}</td>
          <td>${u.email}</td>
          <td>
            <span class="pill ${u.role}">${u.role}</span>
          </td>
          <td class="actions">
            ${u.role === 'admin'
              ? `<button class="btn-secondary act-demote">Demote</button>`
              : `<button class="btn-secondary act-promote">Promote</button>`}
            <button class="btn-danger act-delete">Delete</button>
          </td>
        </tr>
      `).join('');
    }catch(e){
      errorEl.textContent = 'Error fetching users.';
    }
  }

  // listener za gumb promote/demote i delete na osnovu klase dom objekta
  tbody.addEventListener('click', async (ev)=>{      //kliknuti element
    const tr = ev.target.closest('tr[data-id]');     //vraca se dataset kliknutog redka
    if(!tr) return;
    const id = Number(tr.dataset.id);                //uzima se id
    if(ev.target.classList.contains('act-promote')){
      await changeRole(id,'admin');
    }else if(ev.target.classList.contains('act-demote')){
      await changeRole(id,'user');
    }else if(ev.target.classList.contains('act-delete')){
      if(confirm('Delete this account? This cannot be undone.')){
        await deleteUser(id);
      }
    }
  });

//promjena statusa

  async function changeRole(id, role){
    errorEl.textContent = '';
    const res = await fetch(`/api/admin/users/${id}/role`, {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ role })
    });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      errorEl.textContent = e.error || 'Error.';
    }
    await loadUsers();             //osvjeziti ui
  }

//brisanje korisnika

  async function deleteUser(id){
    errorEl.textContent = '';
    const res = await fetch(`/api/admin/users/${id}`, { method:'DELETE' });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      errorEl.textContent = e.error || 'Error.';
    }
    await loadUsers();              //osvjeziti ui
  }

//logout


  document.getElementById('logoutBtn').addEventListener('click', async ()=>{
    await fetch('/api/logout', { method:'POST' });
    location.href = 'login.html';
  });

  await loadUsers();            //ucitavanje usera nakon admin provjere


  
  // ---------- CACHED ANIME (LIST + DELETE) ----------
  async function loadCacheList() {
    const $list = document.querySelector('#cacheList');
    const $empty = document.querySelector('#cacheEmpty');
    $list.innerHTML = '<div class="muted">Loading…</div>';

    try {
      const rows = await fetch('/api/admin/anime-cache').then(r => r.json());
      if (!rows || rows.length === 0) {
        $list.innerHTML = '';
        $empty.hidden = false;
        return;
      }
      $empty.hidden = true;

      const html = rows.map(r => `
        <div class="row" data-id="${r.mal_id}" style="display:flex;align-items:center;gap:12px;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2a2a2a;">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <strong>${r.title || 'Untitled'}</strong>
            <span class="muted">(#${r.mal_id})</span>
          </div>
          <button class="btn btn-danger" data-action="del">Delete</button>
        </div>
      `).join('');
      $list.innerHTML = html;
    } catch {
      $list.innerHTML = '';
      document.querySelector('#cacheEmpty').hidden = false;
    }
  }

  function bindCacheActions() {
    const $list = document.querySelector('#cacheList');
    if (!$list) return;

    $list.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action="del"]');
      if (!btn) return;
      const row = e.target.closest('.row');
      const id = Number(row?.dataset?.id);
      if (!id) return;

      if (!confirm(`Delete cache entry #${id}?`)) return;

      const res = await fetch(`/api/admin/anime-cache/${id}`, { method: 'DELETE' });
      if (res.ok) {
        row.remove();
        const anyLeft = document.querySelectorAll('#cacheList .row').length > 0;
        if (!anyLeft) document.querySelector('#cacheEmpty').hidden = false;
      } else {
        alert('Delete failed.');
      }
    });
  }

  // init cache section
  bindCacheActions();
  await loadCacheList();

})();
