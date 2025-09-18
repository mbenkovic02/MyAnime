// ========== Anime details (simplified: top kao original; Characters & Recommended s Load More) ==========
const $ = s => document.querySelector(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const id = Number(new URLSearchParams(location.search).get('id'));
const CHUNK = 5;

let currentUser = null;
const FAVORITES = new Set();

// Characters state
let allCharacters = [];
let charRendered = 0;

// Recommendations state
let recItems = [];      // normalizirani entry objekti
let recRendered = 0;
let recPage = 1;
let recHasNext = true;

// Mali fetch s retry/backoffom
async function jikanFetch(url, { retries = 2, backoffMs = 800 } = {}) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && i < retries) {
      await sleep(backoffMs * (i + 1));
      continue;
    }
    throw new Error('Jikan error ' + res.status);
  }
}

// ---- Auth & favorites ----
async function setupAuth(){
  const box = $('#userInfo');
  try{
    const u = await fetch('/api/user').then(r=>r.json());
    currentUser = u || null;
    if (u) {
      box.innerHTML = `<span class="user-name">Hi, ${u.first_name || ''}</span>
                       <button id="logoutBtn" class="btn-secondary">Logout</button>`;
      $('#logoutBtn')?.addEventListener('click', async ()=>{
        await fetch('/api/logout', {method:'POST'});
        location.href = 'index.html';
      });
    } else {
      box.innerHTML = `<a class="btn-secondary" href="login.html">Login</a>
                       <a class="btn-secondary" href="register.html">Register</a>`;
    }
  } catch { box.innerHTML = ''; }
}

async function loadFavoriteIds() {
  try {
    const ids = await fetch('/api/favorites').then(r=> r.ok ? r.json() : []);
    FAVORITES.clear(); ids.forEach(x => FAVORITES.add(Number(x)));
  } catch {}
}

function syncFavButtonPressed() {
  const pressed = FAVORITES.has(id);
  const btn = $('#favBtn');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(pressed));
  btn.title = pressed ? 'Ukloni iz mojih' : 'Dodaj u moje';
  // ★ CHANGE: oboji zvjezdicu – zeleno ako je favorit, crno ako nije
  btn.style.background = pressed ? '#16a34a' : '#000000';
}

function bindFavButton() {
  $('#favBtn').addEventListener('click', async ()=>{
    if (!currentUser) { alert('Prijavi se da bi koristio favorite.'); return; }
    if (FAVORITES.has(id)) {
      const res = await fetch('/api/favorites', {
        method:'DELETE', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ anime_id: id })
      });
      if (res.ok) { FAVORITES.delete(id); syncFavButtonPressed(); }
    } else {
      const res = await fetch('/api/favorites', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ anime_id: id })
      });
      if (res.ok) { FAVORITES.add(id); syncFavButtonPressed(); }
    }
  });
}

// ---- Rendering helpers ----
function animeCardHTML(a){
  const aid = Number(a.mal_id);
  const img = a.images?.jpg?.image_url || '';
  const title = a.title || '';
  const score = (a.score ?? 0) ? `<span class="badge">${a.score.toFixed(1)}</span>` : '';
  const isFav = FAVORITES.has(aid);
  const starTitle = isFav ? 'Ukloni iz mojih' : 'Dodaj u moje';
  const starPressed = isFav ? 'true' : 'false';
  return `
    <article class="card" role="listitem" data-id="${aid}">
      <button class="star" title="${starTitle}" aria-pressed="${starPressed}">★</button>
      <a href="anime.html?id=${aid}">
        ${score}
        <img src="${img}" alt="${title}">
        <h3>${title}</h3>
      </a>
    </article>`;
}

// Likovi – bez linkova
function characterCardHTML(c){
  const img = c.character?.images?.jpg?.image_url || '';
  const name = c.character?.name || '';
  const role = c.role || '';
  return `
    <article class="card char" role="listitem">
      <img src="${img}" alt="${name}">
      <h3>${name}</h3>
      <div class="muted" style="padding:0 10px 10px">${role}</div>
    </article>`;
}

// ★ u recommended karticama
function bindRecCardStars(){
  $('#recGrid').addEventListener('click', async (e)=>{
    const btn = e.target.closest('.star'); if(!btn) return;
    const card = e.target.closest('.card'); const aid = Number(card?.dataset?.id);
    if(!aid) return;
    if (!currentUser) { alert('Prijavi se da bi koristio favorite.'); return; }
    if (FAVORITES.has(aid)) {
      const res = await fetch('/api/favorites', {
        method:'DELETE', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ anime_id: aid })
      });
      if (res.ok){ FAVORITES.delete(aid); btn.setAttribute('aria-pressed','false'); btn.title='Dodaj u moje'; }
    } else {
      const res = await fetch('/api/favorites', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ anime_id: aid })
      });
      if (res.ok){ FAVORITES.add(aid); btn.setAttribute('aria-pressed','true'); btn.title='Ukloni iz mojih'; }
    }
  });
}

// ---- Details (s fallbackom na cache) ----
async function loadDetails(){
  let data = null;
  try {
    data = await jikanFetch(`https://api.jikan.moe/v4/anime/${id}/full`).then(x=>x?.data);
  } catch {}

  // Fallback na lokalni cache
  if (!data) {
    const c = await fetch(`/api/anime-cache/${id}`).then(r => r.ok ? r.json() : null).catch(()=>null);
    if (c) {
      document.title = `${c.title} – MyAnime`;
      $('#poster').src = c.image_url || '';
      $('#poster').alt = c.title || '';
      $('#title').textContent = c.title || '—';
      $('#genres').textContent = ''; // cache nema žanrove
      const eps = c.episodes != null ? `${c.episodes} ep` : '';
      const year = c.year || '';
      const status = c.status || '';
      $('#meta').textContent = [eps, year, status].filter(Boolean).join(' • ') || '—';
      $('#synopsis').textContent = c.synopsis || '—';
      $('#scoreBadge').textContent = c.score != null ? Number(c.score).toFixed(1) : '—';
      return; // gotovo; likovi/preporuke ostaju s Jikana
    }
    // nema ni na cacheu
    throw new Error('not found');
  }

  document.title = `${data.title} – MyAnime`;
  const img = data.images?.jpg?.large_image_url || data.images?.jpg?.image_url;
  $('#poster').src = img || '';
  $('#poster').alt = data.title || '';

  $('#title').textContent = data.title || '—';
  $('#genres').textContent = (data.genres||[]).map(g=>g.name).join(', ') || '—';

  const eps = data.episodes != null ? `${data.episodes} ep` : '';
  const year = data.year || (data.aired?.prop?.from?.year || '');
  const status = data.status || '';
  $('#meta').textContent = [eps, year, status].filter(Boolean).join(' • ') || '—';

  $('#synopsis').textContent = data.synopsis || '—';
  $('#scoreBadge').textContent = data.score != null ? data.score.toFixed(1) : '—';
}

// ---- Characters ----
async function loadCharacters(){
  const data = await jikanFetch(`https://api.jikan.moe/v4/anime/${id}/characters`);
  allCharacters = data?.data || [];
  renderMoreCharacters(); // prvih 5
}

function renderMoreCharacters(){
  const grid = $('#charsGrid');
  const next = allCharacters.slice(charRendered, charRendered + CHUNK);
  grid.insertAdjacentHTML('beforeend', next.map(characterCardHTML).join(''));
  charRendered += next.length;
  if (charRendered >= allCharacters.length) $('#charsMore').disabled = true;
}

// ---- Recommended ----
async function fetchRecPage(){
  if (!recHasNext) return;
  const url = `https://api.jikan.moe/v4/anime/${id}/recommendations?page=${recPage}`;
  const json = await jikanFetch(url);
  const list = Array.isArray(json?.data) ? json.data : [];
  recHasNext = !!json?.pagination?.has_next_page;
  recPage += 1;

  // normaliziraj: svaki item ima .entry (ili array) -> spremi samo entry s mal_id/slikom/naslovom
  for (const rec of list) {
    const e = Array.isArray(rec.entry) ? rec.entry[0] : rec.entry;
    if (e && e.mal_id) recItems.push(e);
  }
}

async function renderMoreRecs(){
  // osiguraj barem CHUNK u cacheu
  while (recItems.length < recRendered + CHUNK && recHasNext) {
    await fetchRecPage();
    await sleep(200); // nježno prema API-ju
  }
  const grid = $('#recGrid');
  const slice = recItems.slice(recRendered, recRendered + CHUNK);
  grid.insertAdjacentHTML('beforeend', slice.map(animeCardHTML).join(''));
  recRendered += slice.length;
  if (recRendered >= recItems.length && !recHasNext) $('#recMore').disabled = true;
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async ()=>{
  if (!id) { location.href = 'index.html'; return; }

  await setupAuth();
  await loadFavoriteIds();
  syncFavButtonPressed();   // postavlja i boju (crna/zelena)
  bindFavButton();
  bindRecCardStars();

  try {
    await loadDetails();
  } catch {
    $('#title').textContent = 'Not found';
    return;
  }

  await loadCharacters();
  await renderMoreRecs();

  $('#charsMore').addEventListener('click', renderMoreCharacters);
  $('#recMore').addEventListener('click', renderMoreRecs);
});
