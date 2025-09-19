const $ = (selector) => document.querySelector(selector);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); //wait funkcija

const id = Number(new URLSearchParams(location.search).get('id'));    //ekstrakcija id-a is url-a

let currentUser = null;       //user data
const FAVORITES = new Set();  //user favorites

// Mali fetch s retry/backoffom
async function jikanFetch(url, { retries = 2, backoffMs = 800 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      return res.json();
    }

    const shouldRetry = res.status === 429 || res.status >= 500;
    const moreRetriesLeft = attempt < retries;

    if (shouldRetry && moreRetriesLeft) {
      const delay = backoffMs * (attempt + 1);
      await sleep(delay);
      continue;
    }

    throw new Error('Jikan error ' + res.status);
  }
}

// ---- Auth & favorites ----

//postavljanje user/logout sectiona
async function setupAuth() {
  const box = $('#userInfo');

  try {
    const me = await fetch('/api/user').then((r) => r.json());
    currentUser = me || null;

    if (me) {
      const first = me.first_name || '';
      box.innerHTML = `
        <span class="user-name">Hi, ${first}</span>
        <button id="logoutBtn" class="btn-secondary">Logout</button>
      `;

      const logoutBtn = $('#logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          await fetch('/api/logout', { method: 'POST' });
          location.href = 'index.html';
        });
      }
    } else {
      box.innerHTML = `
        <a class="btn-secondary" href="login.html">Login</a>
        <a class="btn-secondary" href="register.html">Register</a>
      `;
    }
  } catch {
    box.innerHTML = '';
  }
}

//fetchanje favorita za prijavljenog usera
async function loadFavoriteIds() {
  try {
    const res = await fetch('/api/favorites');
    const ids = res.ok ? await res.json() : [];
    FAVORITES.clear();
    ids.forEach((x) => FAVORITES.add(Number(x)));
  } catch {
    // ignore
  }
}

//sync favorite buttona
function syncFavButtonPressed() {
  const pressed = FAVORITES.has(id);
  const btn = $('#favBtn');
  if (!btn) return;

  btn.setAttribute('aria-pressed', String(pressed));
  btn.title = pressed ? 'Ukloni iz mojih' : 'Dodaj u moje';
  // ★ CHANGE: oboji zvjezdicu – zeleno ako je favorit, crno ako nije
  btn.style.background = pressed ? '#16a34a' : '#000000';
}

//event listener na buttonu
function bindFavButton() {
  const btn = $('#favBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (!currentUser) {
      alert('Prijavi se da bi koristio favorite.');
      return;
    }

    const headers = { 'Content-Type': 'application/json' };

    if (FAVORITES.has(id)) {
      const res = await fetch('/api/favorites', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ anime_id: id }),
      });
      if (res.ok) {
        FAVORITES.delete(id);
        syncFavButtonPressed();
      }
    } else {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers,
        body: JSON.stringify({ anime_id: id }),
      });
      if (res.ok) {
        FAVORITES.add(id);
        syncFavButtonPressed();
      }
    }
  });
}

// ---- Details (s fallbackom na cache) ----
async function loadDetails() {
  let data = null;

  try {
    const json = await jikanFetch(`https://api.jikan.moe/v4/anime/${id}/full`);
    data = json && json.data ? json.data : null;
  } catch {
    // ignore
  }

  // Fallback na lokalni cache
  if (!data) {
    const c = await fetch(`/api/anime-cache/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

    if (c) {
      document.title = `${c.title} – MyAnime`;

      const poster = $('#poster');
      if (poster) {
        poster.src = c.image_url || '';
        poster.alt = c.title || '';
      }

      const titleEl = $('#title');
      if (titleEl) titleEl.textContent = c.title || '—';

      const genresEl = $('#genres');
      if (genresEl) genresEl.textContent = ''; // cache nema žanrove

      const eps = c.episodes != null ? `${c.episodes} ep` : '';
      const year = c.year || '';
      const status = c.status || '';
      const meta = [eps, year, status].filter(Boolean).join(' • ') || '—';
      const metaEl = $('#meta');
      if (metaEl) metaEl.textContent = meta;

      const synopsisEl = $('#synopsis');
      if (synopsisEl) synopsisEl.textContent = c.synopsis || '—';

      const scoreEl = $('#scoreBadge');
      if (scoreEl) scoreEl.textContent = c.score != null ? Number(c.score).toFixed(1) : '—';

      return;
    }

    // nema ni na cacheu
    throw new Error('not found');
  }

  document.title = `${data.title} – MyAnime`;

  const img =
    (data.images &&
      data.images.jpg &&
      (data.images.jpg.large_image_url || data.images.jpg.image_url)) ||
    '';
  const poster = $('#poster');
  if (poster) {
    poster.src = img || '';
    poster.alt = data.title || '';
  }

  const titleEl = $('#title');
  if (titleEl) titleEl.textContent = data.title || '—';

  const genres = Array.isArray(data.genres) ? data.genres.map((g) => g.name).join(', ') : '';
  const genresEl = $('#genres');
  if (genresEl) genresEl.textContent = genres || '—';

  const eps = data.episodes != null ? `${data.episodes} ep` : '';
  const year = data.year || (data.aired && data.aired.prop && data.aired.prop.from && data.aired.prop.from.year) || '';
  const status = data.status || '';
  const meta = [eps, year, status].filter(Boolean).join(' • ') || '—';
  const metaEl = $('#meta');
  if (metaEl) metaEl.textContent = meta;

  const synopsisEl = $('#synopsis');
  if (synopsisEl) synopsisEl.textContent = data.synopsis || '—';

  const scoreEl = $('#scoreBadge');
  if (scoreEl) {
    const val = data.score != null ? data.score.toFixed(1) : '—';
    scoreEl.textContent = val;
  }
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  if (!id) {
    location.href = 'index.html';
    return;
  }

  await setupAuth();
  await loadFavoriteIds();
  syncFavButtonPressed();   // postavlja i boju (crna/zelena)
  bindFavButton();

  try {
    await loadDetails();
  } catch {
    const titleEl = $('#title');
    if (titleEl) titleEl.textContent = 'Not found';
    return;
  }
});
