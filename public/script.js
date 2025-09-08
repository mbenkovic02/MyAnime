// ========== Globals & helpers ==========
const $ = s => document.querySelector(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Keep favorite ids in memory to paint ★ initially
const FAVORITES = new Set();

// How many cards we keep per row (older trimmed)
const MAX_CARDS_PER_ROW = 120;

// Jikan fetch with simple retry (429/rate-limit + transient)
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

// ========== Card renderer ==========
function cardTemplate({ mal_id, title, images, score }) {
  const idNum = Number(mal_id);
  const isFav = FAVORITES.has(idNum);

  const img =
    images?.jpg?.large_image_url ||
    images?.jpg?.image_url ||
    images?.webp?.large_image_url ||
    images?.webp?.image_url ||
    'https://via.placeholder.com/300x420?text=No+Image';
  const scoreBadge = (typeof score === 'number' && !isNaN(score))
    ? `<span class="badge">★ ${score}</span>` : '';

  const starTitle = isFav ? 'Remove from My anime' : 'Add to My anime';
  const starPressed = isFav ? 'true' : 'false';

  return `
    <article class="card" role="listitem" data-id="${idNum}">
      <button class="star" title="${starTitle}" aria-label="${starTitle}" aria-pressed="${starPressed}">★</button>
      <a href="anime.html?id=${idNum}">
        ${scoreBadge}
        <img src="${img}" alt="${title ?? ''}">
        <h3>${title ?? ''}</h3>
      </a>
    </article>
  `;
}

// ========== Row controls (arrows + infinite) ==========
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

const rowPager = {}; // { rowId: { endpointBase, mapFn, page, hasNext, loading } }

function initPagedRow(rowId, endpointBase, mapFn){
  const cont = document.getElementById(rowId);
  rowPager[rowId] = { endpointBase, mapFn, page: 1, hasNext: true, loading: false };

  cont.innerHTML = 'Loading…';
  loadNextPage(rowId, true);

  cont.addEventListener('scroll', ()=>maybeLoadMore(rowId));
}

function makePagedUrl(endpointBase, page){
  const url = new URL(endpointBase);
  url.searchParams.set('page', String(page));
  if(!url.searchParams.has('limit')) url.searchParams.set('limit','24');
  return url.toString();
}

function pruneRowIfNeeded(rowId){
  const cont = document.getElementById(rowId);
  if (!cont) return;
  const cards = cont.querySelectorAll('.card');
  const excess = cards.length - MAX_CARDS_PER_ROW;
  if (excess > 0 && nearRightEnd(cont)) {
    for (let i = 0; i < excess; i++) cont.removeChild(cont.firstElementChild);
  }
}

async function loadNextPage(rowId, first=false){
  const state = rowPager[rowId];
  if(!state || state.loading || !state.hasNext) return;

  state.loading = true;
  const cont = document.getElementById(rowId);
  try{
    const url = makePagedUrl(state.endpointBase, state.page);
    const json = await jikanFetch(url, { retries: 3, backoffMs: 1000 });
    const list = Array.isArray(json?.data) ? json.data : [];
    const items = (state.mapFn ? list.map(state.mapFn).filter(Boolean) : list);

    if(first) cont.innerHTML = '';

    if(items.length){
      const tmp = document.createElement('div');
      tmp.innerHTML = items.map(cardTemplate).join('');
      while (tmp.firstChild) cont.appendChild(tmp.firstChild);
    }
    state.hasNext = !!json?.pagination?.has_next_page;
    state.page += 1;

    pruneRowIfNeeded(rowId);
  }catch{
    if(first) cont.innerHTML = `<p class="muted">Error loading.</p>`;
  }finally{
    state.loading = false;
  }
}

function maybeLoadMore(rowId){
  const cont = document.getElementById(rowId);
  const state = rowPager[rowId];
  if(!cont || !state) return;
  if(nearRightEnd(cont) && state.hasNext && !state.loading){
    loadNextPage(rowId, false);
  }
}

// ========== Auth UI ==========
async function refreshUserUI(){
  const box = $('#userInfo');
  try{
    const u = await fetch('/api/user').then(r=>r.json());
    if(u){
      box.innerHTML = `
        <span class="name">Hello, ${u.first_name} ${u.last_name}</span>
        <button class="btn-secondary logout">Logout</button>`;
      box.querySelector('.logout').addEventListener('click', async ()=>{
        await fetch('/api/logout',{method:'POST'});
        location.reload();
      });
      return true;
    }else{
      box.innerHTML = `
        <a class="btn-secondary" href="login.html">Login</a>
        <a class="btn-secondary" href="register.html">Register</a>`;
      return false;
    }
  }catch{
    box.innerHTML = `
      <a class="btn-secondary" href="login.html">Login</a>
      <a class="btn-secondary" href="register.html">Register</a>`;
    return false;
  }
}

// Load favorites set (if logged in)
async function loadFavoritesSet(){
  FAVORITES.clear();
  try{
    const u = await fetch('/api/user').then(r=>r.json());
    if(!u) return false;
    const resp = await fetch('/api/favorites');
    if(!resp.ok) return false;
    const ids = await resp.json();
    (ids || []).forEach(id => FAVORITES.add(Number(id)));
    return true;
  }catch{
    return false;
  }
}

// ========== Genres ==========
async function loadGenres(){
  try{
    const { data } = await jikanFetch('https://api.jikan.moe/v4/genres/anime', { retries: 2, backoffMs: 800 });
    const sel = $('#genreSelect');
    data.forEach(g=>{
      const opt = document.createElement('option');
      opt.value = g.mal_id;
      opt.textContent = g.name;
      sel.appendChild(opt);
    });
  }catch{}
}

// ========== Generic fill (search / favorites one-shot) ==========
async function fillRow(rowId, endpoint, mapFn, { showEmpty=false } = {}) {
  const cont = document.getElementById(rowId);
  cont.innerHTML = 'Loading…';
  try {
    const json = await jikanFetch(endpoint, { retries: 3, backoffMs: 1000 });
    const list = Array.isArray(json?.data) ? json.data : [];
    const items = (mapFn ? list.map(mapFn).filter(Boolean) : list);
    cont.innerHTML = items.length
      ? items.map(cardTemplate).join('')
      : (showEmpty ? '<p class="muted">No data.</p>' : '');
  } catch {
    cont.innerHTML = `<p class="muted">Error loading.</p>`;
  }
}

// ========== Home rows ==========
async function loadRows(){
  // popular (by popularity) — paginated
  initPagedRow('row-popular', 'https://api.jikan.moe/v4/top/anime?filter=bypopularity&limit=24');

  await sleep(350);

  // airing now
  initPagedRow('row-airing', 'https://api.jikan.moe/v4/top/anime?filter=airing&limit=24');

  await sleep(350);

  // top rated
  initPagedRow('row-top', 'https://api.jikan.moe/v4/top/anime?limit=24');

  await sleep(350);

  // season now
  initPagedRow('row-season', 'https://api.jikan.moe/v4/seasons/now?limit=24');
}

// ========== Search ==========
async function doSearch(){
  const q = $('#searchInput').value.trim();
  const genre = $('#genreSelect').value;
  if(!q && !genre){
    $('#row-search-wrap').hidden = true;
    return;
  }
  const url = new URL('https://api.jikan.moe/v4/anime');
  if(q) url.searchParams.set('q', q);
  if(genre) url.searchParams.set('genres', genre);
  url.searchParams.set('limit', '24');
  $('#row-search-wrap').hidden = false;
  await fillRow('row-search', url.toString(), null, { showEmpty:true });
  $('#row-search-wrap').scrollIntoView({ behavior: 'smooth', block:'start' });
}

// ========== Favorites toggle view ==========
async function toggleMyAnime(checked){
  const favRowWrap = $('#row-favorites-wrap');
  const favRow = $('#row-favorites');
  const favHint = $('#fav-hint');

  if(!checked){
    favRowWrap.hidden = true;
    // show standard rows
    [...document.querySelectorAll('main .row')].forEach(sec=>{
      if(sec.id && (sec.id.startsWith('row-') && !sec.id.includes('favorites') && !sec.id.includes('search'))) sec.hidden = false;
    });
    return;
  }
  // hide standard rows
  [...document.querySelectorAll('main .row')].forEach(sec=>{
    if(sec.id && (sec.id.startsWith('row-') && !sec.id.includes('favorites') && !sec.id.includes('search'))) sec.hidden = true;
  });
  favRowWrap.hidden = false;
  favRow.innerHTML = 'Loading…';
  favHint.textContent = '';

  try{
    const user = await fetch('/api/user').then(r=>r.json());
    if(!user){
      favRow.innerHTML = '';
      favHint.textContent = 'Sign in to view your anime.';
      return;
    }
    // ensure FAVORITES is up-to-date
    await loadFavoritesSet();

    const ids = Array.from(FAVORITES);
    if(!ids.length){
      favRow.innerHTML = `<p class="muted">You have no saved anime yet.</p>`;
      return;
    }

    // fetch first 24 favorites details
    const slice = ids.slice(0, 24);
    const items = [];
    for(const id of slice){
      const d = await jikanFetch(`https://api.jikan.moe/v4/anime/${id}`, { retries: 2, backoffMs: 800 }).catch(()=>null);
      if(d?.data) items.push(d.data);
      await sleep(300);
    }
    favRow.innerHTML = items.map(cardTemplate).join('');
  }catch{
    favRow.innerHTML = `<p class="muted">Favorites API is not ready yet.</p>`;
  }
}

// ========== Star click: add / remove favorite ==========
async function handleStarClick(e){
  const btn = e.target.closest('.star');
  if(!btn) return;

  const card = btn.closest('.card');
  const animeId = Number(card?.dataset?.id || 0);
  if(!animeId) return;

  try{
    const user = await fetch('/api/user').then(r=>r.json());
    if(!user) return alert('Please sign in to save anime.');

    const pressed = btn.getAttribute('aria-pressed') === 'true';

    if(pressed){
      // remove (do NOT remove card from favorites row)
      const resp = await fetch(`/api/favorites/${animeId}`, { method: 'DELETE' });
      if(!resp.ok) throw new Error('delete failed');
      FAVORITES.delete(animeId);
      btn.setAttribute('aria-pressed','false');
      btn.title = 'Add to My anime';
      btn.setAttribute('aria-label','Add to My anime');
    }else{
      // add
      const resp = await fetch('/api/favorites', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ anime_id: animeId })
      });
      if(!resp.ok) throw new Error('post failed');
      FAVORITES.add(animeId);
      btn.setAttribute('aria-pressed','true');
      btn.title = 'Remove from My anime';
      btn.setAttribute('aria-label','Remove from My anime');
    }
  }catch{
    alert('Action failed. Please try again.');
  }
}

// ========== Init ==========
document.addEventListener('DOMContentLoaded', async () => {
  // arrows
  setupRowControls();

  // auth UI
  const logged = await refreshUserUI();

  // load favorites set (if logged)
  if (logged) await loadFavoritesSet();

  // genres and rows
  await loadGenres();
  await loadRows();

  // search
  $('#searchBtn').addEventListener('click', doSearch);
  $('#searchInput').addEventListener('keydown', e=>{ if(e.key === 'Enter') doSearch(); });

  // show my anime
  $('#showMine').addEventListener('change', e => toggleMyAnime(e.target.checked));

  // ★ toggle
  document.body.addEventListener('click', handleStarClick);
});
