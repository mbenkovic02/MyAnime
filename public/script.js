

// Helpers
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PAGE_SIZE = 25;

const state = {
  mode: 'browse', // 'browse' | 'favorites'
  q: '',
  genre: '',      // MAL genre/theme/demographic/explicit id (string)
  sort: 'popular',
  page: 1,
};

const FAVORITES = new Set();
const favoritesCache = {
  loaded: false,
  items: [], // array of anime objects from Jikan
};

// Jikan fetch with tiny retry for 429/5xx
async function jikanFetch(url, { retries = 2, backoffMs = 700 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();

    const retriable = res.status === 429 || res.status >= 500;
    if (retriable && attempt < retries) {
      await sleep(backoffMs * (attempt + 1));
      continue;
    }
    throw new Error('Jikan error ' + res.status);
  }
}

// ---- Genres: fetch dynamically (all types) ----
async function populateGenres() {
  const sel = $('#genreSelect');
  if (!sel) return;

  // clear all except first option
  while (sel.options.length > 1) sel.remove(1);

  try {
    const data = await jikanFetch('https://api.jikan.moe/v4/genres/anime');
    const items = (data?.data || []).slice();

    // Sort by name; 
    items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    for (const g of items) {
      const opt = document.createElement('option');
      opt.value = String(g.mal_id);
      opt.textContent = g.name;
      // keep type if you ever want to group/filter later
      opt.dataset.type = g.type || '';
      sel.appendChild(opt);
    }
  } catch {
    
  }
}

// Build browse URL based on state
function buildBrowseUrl({ q, genre, sort, page }) {
  const u = new URL('https://api.jikan.moe/v4/anime');
  u.searchParams.set('page', page);
  u.searchParams.set('limit', PAGE_SIZE);

  if (q && q.trim().length >= 2) u.searchParams.set('q', q.trim());
  if (genre) u.searchParams.set('genres', genre);

  switch (sort) {
    case 'popular':
      u.searchParams.set('order_by', 'members');
      u.searchParams.set('sort', 'desc');
      break;
    case 'least_popular':
      u.searchParams.set('order_by', 'members');
      u.searchParams.set('sort', 'asc');
      break;
    case 'az':
      u.searchParams.set('order_by', 'title');
      u.searchParams.set('sort', 'asc');
      break;
    case 'za':
      u.searchParams.set('order_by', 'title');
      u.searchParams.set('sort', 'desc');
      break;
    case 'top_rated':
      u.searchParams.set('order_by', 'score');
      u.searchParams.set('sort', 'desc');
      break;
    case 'worst_rated':
      u.searchParams.set('order_by', 'score');
      u.searchParams.set('sort', 'asc');
      break;
    case 'airing':
      u.searchParams.set('status', 'airing');
      u.searchParams.set('order_by', 'members');
      u.searchParams.set('sort', 'desc');
      break;
    case 'upcoming':
      u.searchParams.set('status', 'upcoming');
      u.searchParams.set('order_by', 'members');
      u.searchParams.set('sort', 'desc');
      break;
  }
  return u.toString();
}

// Render one card
function cardHTML(anime) {
  const id = Number(anime.mal_id);
  const title = anime.title || '';
  const img = anime.images?.jpg?.image_url || '';
  const score = anime.score ?? 0;
  const scoreBadge = score ? `<span class="badge">${score.toFixed(1)}</span>` : '';
  const isFav = FAVORITES.has(id);
  const starTitle = isFav ? 'Remove from my anime' : 'Add to my anime';

  // ★ CHANGE: inline pozadina kruga — crna (nije favorit) / zelena (je favorit)
  const starBg = isFav ? '#16a34a' : '#000000';

  return `
    <article class="card" role="listitem" data-id="${id}">
      <button class="star" style="background:${starBg}" title="${starTitle}" aria-label="${starTitle}" aria-pressed="${isFav}">★</button>
      <a href="anime.html?id=${id}">
        ${scoreBadge}
        <img src="${img}" alt="${title}">
        <h3>${title}</h3>
      </a>
    </article>
  `;
}

// Render a list (append or replace)
function renderList(animes, { append = false } = {}) {
  const grid = $('#grid');
  if (!append) grid.innerHTML = '';
  grid.insertAdjacentHTML('beforeend', animes.map(cardHTML).join(''));
  $('#emptyHint').hidden = grid.children.length > 0;
}

// Favorites helpers
async function loadFavoriteIds() {
  try {
    const ids = await fetch('/api/favorites').then((r) => (r.ok ? r.json() : []));
    FAVORITES.clear();
    ids.forEach((x) => FAVORITES.add(Number(x)));
  } catch {
    // ignore
  }
}

// Fallback mapper: cache row -> "Jikan-like" object za cardHTML
function mapCacheToAnime(cacheRow) {
  return {
    mal_id: Number(cacheRow.mal_id),
    title: cacheRow.title,
    images: { jpg: { image_url: cacheRow.image_url } },
    score: cacheRow.score ?? null,
  };
}

async function ensureFavoritesLoaded() {
  if (favoritesCache.loaded) return;

  await loadFavoriteIds();
  const ids = Array.from(FAVORITES);
  favoritesCache.items = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];

    try {
      const data = await jikanFetch(`https://api.jikan.moe/v4/anime/${id}`);
      if (data?.data) {
        favoritesCache.items.push(data.data);
      } else {
        const c = await fetch(`/api/anime-cache/${id}`).then((r) => (r.ok ? r.json() : null));
        if (c) favoritesCache.items.push(mapCacheToAnime(c));
      }
    } catch {
      try {
        const c = await fetch(`/api/anime-cache/${id}`).then((r) => (r.ok ? r.json() : null));
        if (c) favoritesCache.items.push(mapCacheToAnime(c));
      } catch {
        // ignore
      }
    }

    await sleep(150); // nježno prema API-ju
  }

  favoritesCache.loaded = true;
}

// Apply filters/sort locally to favorites
function filterSortFavorites() {
  let items = favoritesCache.items.slice();

  // search
  const q = state.q.trim().toLowerCase();
  if (q.length >= 2) {
    items = items.filter((a) => (a.title || '').toLowerCase().includes(q));
  }

  // genre (check across all arrays returned by Jikan)
  if (state.genre) {
    const gid = Number(state.genre);
    items = items.filter((a) => {
      const all = []
        .concat(a.genres || [])
        .concat(a.themes || [])
        .concat(a.demographics || [])
        .concat(a.explicit_genres || []);
      const ids = all.map((g) => g.mal_id);
      return ids.includes(gid);
    });
  }

  // sort
  const by = (fn, dir = 1) => (a, b) => (fn(a) > fn(b) ? dir : fn(a) < fn(b) ? -dir : 0);
  switch (state.sort) {
    case 'popular':
      items.sort(by((a) => a.members ?? a.popularity ?? 0, 1));
      break;
    case 'least_popular':
      items.sort(by((a) => a.members ?? a.popularity ?? 0, -1));
      break;
    case 'az':
      items.sort(by((a) => (a.title || '').toLowerCase(), 1));
      break;
    case 'za':
      items.sort(by((a) => (a.title || '').toLowerCase(), -1));
      break;
    case 'top_rated':
      items.sort(by((a) => a.score ?? 0, -1));
      break;
    case 'worst_rated':
      items.sort(by((a) => a.score ?? 0, 1));
      break;
    case 'airing':
      items = items.filter((a) => (a.status || '').toLowerCase().includes('air'));
      items.sort(by((a) => a.members ?? a.popularity ?? 0, 1));
      break;
    case 'upcoming':
      items = items.filter((a) => (a.status || '').toLowerCase().includes('upcoming'));
      items.sort(by((a) => a.members ?? a.popularity ?? 0, 1));
      break;
  }
  return items;
}

// Main loaders
async function loadBrowse({ append = false } = {}) {
  const url = buildBrowseUrl(state);
  const data = await jikanFetch(url);
  const list = data?.data || [];
  renderList(list, { append });

  // enable/disable load more
  $('#loadMore').disabled = list.length < PAGE_SIZE;
}

async function loadFavorites({ append = false } = {}) {
  await ensureFavoritesLoaded();
  const items = filterSortFavorites();
  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);
  renderList(pageItems, { append });

  $('#loadMore').disabled = start + PAGE_SIZE >= items.length;
}

// Event handlers
function debounce(fn, ms = 500) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

async function refresh({ resetPage = false } = {}) {
  if (resetPage) state.page = 1;
  $('#loadMore').disabled = true;

  if (state.mode === 'favorites') {
    await loadFavorites({ append: false });
  } else {
    await loadBrowse({ append: false });
  }
}

function bindUI() {
  // Fetch genres once (dynamic)
  populateGenres();

  // Dynamic search (only input is auto)
  const onInput = debounce(async (ev) => {
    state.q = ev.target.value;
    await refresh({ resetPage: true });
  }, 500);
  $('#searchInput').addEventListener('input', onInput);

  // Other controls apply on Search click
  $('#searchBtn').addEventListener('click', async () => {
    state.genre = $('#genreSelect').value || '';
    state.sort = $('#sortSelect')?.value || 'popular';
    state.q = $('#searchInput').value.trim();
    await refresh({ resetPage: true });
  });

  // Enter key triggers search immediately
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#searchBtn').click();
    }
  });

  // Favorites toggle switches mode immediately
  $('#showMine').addEventListener('change', async (e) => {
    state.mode = e.target.checked ? 'favorites' : 'browse';
    await refresh({ resetPage: true });
  });

  // Load more
  $('#loadMore').addEventListener('click', async () => {
    state.page += 1;
    if (state.mode === 'favorites') {
      await loadFavorites({ append: true });
    } else {
      await loadBrowse({ append: true });
    }
  });

  // Star click (event delegation)
  $('#grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('.star');
    if (!btn) return;

    const card = e.target.closest('.card');
    const id = Number(card?.dataset?.id);
    if (!id) return;

    // must be logged in
    const me = await fetch('/api/user').then((r) => r.json());
    if (!me) {
      alert('Prijavi se da bi koristio favorite.');
      return;
    }

    if (FAVORITES.has(id)) {
      // remove
      const res = await fetch('/api/favorites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anime_id: id }),
      });
      if (res.ok) {
        FAVORITES.delete(id);
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'Add to my anime';
        btn.style.background = '#000000'; // ★ CHANGE: boja kruga kad nije favorit
        if (state.mode === 'favorites') {
          // remove from cache and DOM
          favoritesCache.items = favoritesCache.items.filter((a) => Number(a.mal_id) !== id);
          card.remove();
        }
      }
    } else {
      // add
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anime_id: id }),
      });
      if (res.ok) {
        FAVORITES.add(id);
        btn.setAttribute('aria-pressed', 'true');
        btn.title = 'Remove from my anime';
        btn.style.background = '#16a34a'; // ★ CHANGE: boja kruga kad je favorit
      }
    }
  });
}

// Auth area
async function setupAuth() {
  const wrap = $('#userInfo');
  const me = await fetch('/api/user').then((r) => r.json()).catch(() => null);
  if (!wrap) return;

  if (!me) {
    wrap.innerHTML = `
      <a class="btn-secondary" href="login.html">Login</a>
      <a class="btn-secondary" href="register.html">Register</a>
    `;
    // disable favorites toggle if logged out
    $('#showMine').disabled = true;
  } else {
    wrap.innerHTML = `
      <span class="user-name">Hi, ${me.first_name || ''}</span>
      <button id="logoutBtn" class="btn-secondary">Logout</button>
    `;
    $('#logoutBtn').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      location.href = 'login.html';
    });
    await loadFavoriteIds(); // ★ CHANGE: osigurava da su FAVORITES popunjeni prije prvog rendera
    $('#showMine').disabled = false;
  }
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  // default sort
  const sortSelect = $('#sortSelect');
  if (sortSelect) sortSelect.value = 'popular';

  bindUI();
  await setupAuth();

  // initial load (browse)
  await refresh({ resetPage: true });
});
