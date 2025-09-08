const $ = s => document.querySelector(s);
const id = Number(new URLSearchParams(location.search).get('id'));
let currentUser = null;

// lokalni set favorita (za sync gumba)
const FAVORITES = new Set();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// retry helper (za 429/5xx)
async function jikanFetch(url, { retries = 2, backoffMs = 900 } = {}) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url);
    if (res.ok) {
      try { return await res.json(); }
      catch { return { data: [], pagination: { has_next_page: false } }; }
    }
    if ((res.status === 429 || res.status >= 500) && i < retries) {
      await sleep(backoffMs * (i + 1));
      continue;
    }
    return { data: [], pagination: { has_next_page: false } };
  }
}

// strelice (isti behavior kao na indexu)
function setupRowControls(){
  document.querySelectorAll('.row-btn').forEach(btn=>{
    const targetId = btn.dataset.target;
    const cont = document.getElementById(targetId);
    if(!cont) return;
    btn.addEventListener('click', ()=>{
      const step = Math.round(cont.clientWidth * 0.9);
      const dir = btn.classList.contains('prev') ? -1 : 1;
      cont.scrollBy({ left: dir * step, behavior: 'smooth' });
      setTimeout(()=>maybeLoadMore(targetId), 320);
    });
  });
}
function nearRightEnd(el, threshold = 48){
  return (el.scrollLeft + el.clientWidth) >= (el.scrollWidth - threshold);
}

// AUTH UI (isti vizual kao homepage)
async function initAuth(){
  try{
    const u = await fetch('/api/user').then(r=>r.json());
    currentUser = u || null;
    const box = $('#userInfo');
    if (u) {
      box.innerHTML = `
        <span class="name">${u.first_name} ${u.last_name}</span>
        <button class="btn-secondary logout">Logout</button>`;
      box.querySelector('.logout')?.addEventListener('click', async ()=>{
        await fetch('/api/logout',{method:'POST'}); location.href = 'index.html';
      });
    } else {
      box.innerHTML = `
        <a class="btn-secondary" href="login.html">Login</a>
        <a class="btn-secondary" href="register.html">Register</a>`;
    }
  }catch{
    currentUser = null;
    $('#userInfo').innerHTML = `
      <a class="btn-secondary" href="login.html">Login</a>
      <a class="btn-secondary" href="register.html">Register</a>`;
  }
}

// učitaj favorite u lokalni set
async function refreshFavoritesSet(){
  FAVORITES.clear();
  if(!currentUser) return;
  try{
    const resp = await fetch('/api/favorites');
    if(!resp.ok) return;
    const ids = await resp.json();
    (ids || []).forEach(x => FAVORITES.add(Number(x)));
  }catch{}
}

// search u headeru vodi na index s queryjem
function initSearchHeader(){
  $('#searchBtn').addEventListener('click', ()=>{
    const q = $('#searchInput').value.trim();
    if(q) location.href = `index.html?q=${encodeURIComponent(q)}`;
  });
  $('#searchInput').addEventListener('keydown', e=>{
    if(e.key === 'Enter'){
      const q = $('#searchInput').value.trim();
      if(q) location.href = `index.html?q=${encodeURIComponent(q)}`;
    }
  });
}

// ---------- DETALJI ----------
(async function loadDetails(){
  try{
    const { data } = await jikanFetch(`https://api.jikan.moe/v4/anime/${id}`, { retries: 3, backoffMs: 1000 });
    if(!data) throw new Error();

    document.title = `${data.title} – MyAnime`;

    const img = data.images?.jpg?.large_image_url || data.images?.jpg?.image_url || data.images?.webp?.large_image_url || data.images?.webp?.image_url;
    $('#poster').src = img || 'https://via.placeholder.com/220x330?text=No+Image';
    $('#poster').alt = data.title || '';

    $('#title').textContent = data.title || '—';
    $('#genres').textContent = (data.genres||[]).map(g=>g.name).join(', ') || '—';

    const parts = [];
    if (data.score != null) parts.push(`★ ${data.score}`);
    if (data.episodes != null) parts.push(`Epizode: ${data.episodes}`);
    if (data.status) parts.push(`Status: ${data.status}`);
    $('#meta').textContent = parts.join(' · ') || '—';

    $('#synopsis').textContent = data.synopsis || 'Nema opisa.';
  }catch{
    $('#title').textContent = 'Greška pri učitavanju.';
    $('#synopsis').textContent = '';
  }
})();

// ========== Infinite za DETALJE ==========
const rowState = {
  characters: { mode:'buffer', buffer: null, index: 0, chunk: 24, loading:false, hasNext:true },
  recommended: { mode:'api', page:1, chunk:24, loading:false, hasNext:true, fallbackBuffer:null, fbIndex:0 }
};

async function loadMoreCharacters(first=false){
  const s = rowState.characters;
  const cont = $('#row-characters');
  if (s.loading || !s.hasNext) return;
  s.loading = true;

  try{
    if (!s.buffer) {
      const json = await jikanFetch(`https://api.jikan.moe/v4/anime/${id}/characters`, { retries: 3, backoffMs: 1000 });
      s.buffer = Array.isArray(json?.data) ? json.data : [];
      s.index = 0;
      if (first) cont.innerHTML = '';
    }

    if (!s.buffer.length) {
      cont.innerHTML = '<p class="muted">Nema podataka.</p>';
      s.hasNext = false;
      return;
    }

    const slice = s.buffer.slice(s.index, s.index + s.chunk);
    s.index += slice.length;
    if (slice.length === 0) { s.hasNext = false; return; }

    const html = slice.map(it=>{
      const name = it.character?.name || '';
      const img = it.character?.images?.jpg?.image_url || it.character?.images?.webp?.image_url;
      const role = it.role || '';
      return `
        <article class="char" role="listitem">
          <img src="${img || 'https://via.placeholder.com/200x280?text=No+Image'}" alt="${name}">
          <h4>${name}</h4>
          <p class="muted">${role}</p>
        </article>
      `;
    }).join('');

    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) cont.appendChild(tmp.firstChild);

    if (s.index >= s.buffer.length) s.hasNext = false;
  }catch{
    if (first) $('#row-characters').innerHTML = '<p class="muted">Greška pri učitavanju.</p>';
  }finally{
    s.loading = false;
  }
}

async function loadMoreRecommended(first=false){
  const s = rowState.recommended;
  const cont = $('#row-recommended');
  if (s.loading || !s.hasNext) return;
  s.loading = true;

  const mapRec = rec=>{
    const e = Array.isArray(rec.entry) ? rec.entry[0] : rec.entry;
    const title = e?.title || '';
    const mal_id = e?.mal_id;
    const img = e?.images?.jpg?.large_image_url || e?.images?.jpg?.image_url || e?.images?.webp?.large_image_url || e?.images?.webp?.image_url;
    if(!mal_id) return '';
    return `
      <article class="card" role="listitem" data-id="${mal_id}">
        <button class="star" title="Dodaj u moje" aria-label="Dodaj u moje" aria-pressed="false">★</button>
        <a href="anime.html?id=${mal_id}">
          <img src="${img || 'https://via.placeholder.com/300x420?text=No+Image'}" alt="${title}">
          <h3>${title}</h3>
        </a>
      </article>
    `;
  };

  try{
    const url = new URL(`https://api.jikan.moe/v4/anime/${id}/recommendations`);
    url.searchParams.set('page', String(s.page));
    url.searchParams.set('limit', String(s.chunk));
    const json = await jikanFetch(url.toString(), { retries: 3, backoffMs: 1000 });

    const list = Array.isArray(json?.data) ? json.data : [];
    const hasNext = !!json?.pagination?.has_next_page;

    if (first) cont.innerHTML = '';
    if (!list.length && s.page === 1) {
      cont.innerHTML = '<p class="muted">Nema preporuka.</p>';
      s.hasNext = false;
      return;
    }
    if (!list.length && !hasNext) {
      s.hasNext = false;
      return;
    }

    const tmp = document.createElement('div');
    tmp.innerHTML = list.map(mapRec).join('');
    while (tmp.firstChild) cont.appendChild(tmp.firstChild);

    s.page += 1;
    s.hasNext = hasNext;
  }catch{
    if (first) cont.innerHTML = '<p class="muted">Greška pri učitavanju.</p>';
  }finally{
    s.loading = false;
  }
}

function maybeLoadMore(rowId){
  const el = document.getElementById(rowId);
  if (!el) return;
  if (!nearRightEnd(el)) return;

  if (rowId === 'row-characters') loadMoreCharacters(false);
  if (rowId === 'row-recommended') loadMoreRecommended(false);
}

// ---------- Favorite (★) na detaljima ----------
function syncFavBtn(){
  const btn = $('#favBtn');
  const saved = FAVORITES.has(id);
  btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
  btn.textContent = saved ? '★ Spremljeno' : '★ Spremi';
  btn.title = saved ? 'Ukloni iz mojih' : 'Dodaj u moje';
}

function initFavoriteButton(){
  const btn = $('#favBtn');
  syncFavBtn();

  btn.addEventListener('click', async ()=>{
    if(!currentUser){
      alert('Prijavite se kako biste spremili anime.');
      return;
    }
    btn.disabled = true;
    try{
      const pressed = btn.getAttribute('aria-pressed') === 'true';
      if(pressed){
        const resp = await fetch(`/api/favorites/${id}`, { method:'DELETE' });
        if(!resp.ok) throw new Error();
        FAVORITES.delete(id);
      }else{
        const resp = await fetch('/api/favorites', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ anime_id: id })
        });
        if(!resp.ok) throw new Error();
        FAVORITES.add(id);
      }
      syncFavBtn();
    }catch{
      alert('Greška pri spremanju. Pokušajte kasnije.');
    }finally{
      btn.disabled = false;
    }
  });
}

// delegiraj klik na ★ unutar "Preporučeno" kartica (samo dodaj)
document.body.addEventListener('click', async (e)=>{
  const btn = e.target.closest('.card .star');
  if(!btn) return;
  if(!currentUser){ alert('Prijavite se kako biste spremili anime.'); return; }
  const card = btn.closest('.card');
  const animeId = Number(card?.dataset?.id);
  if(!animeId) return;
  btn.disabled = true;
  try{
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    if(pressed){
      // opcionalno: dopusti unfavorite i ovdje
      const resp = await fetch(`/api/favorites/${animeId}`, { method:'DELETE' });
      if(!resp.ok) throw new Error();
      btn.setAttribute('aria-pressed','false');
    }else{
      const resp = await fetch('/api/favorites', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ anime_id: animeId })
      });
      if(!resp.ok) throw new Error();
      btn.setAttribute('aria-pressed','true');
    }
  }catch{
    alert('Greška pri spremanju. Pokušajte kasnije.');
  }finally{
    btn.disabled = false;
  }
});

// init
document.addEventListener('DOMContentLoaded', async ()=>{
  setupRowControls();
  initSearchHeader();
  await initAuth();
  await refreshFavoritesSet(); // važno: dohvati favorite prije sync-a gumba
  initFavoriteButton();
  // infinite redovi
  $('#row-characters').addEventListener('scroll', ()=>maybeLoadMore('row-characters'));
  $('#row-recommended').addEventListener('scroll', ()=>maybeLoadMore('row-recommended'));
  loadMoreCharacters(true);
  loadMoreRecommended(true);
});
