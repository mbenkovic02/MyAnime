const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const db = new sqlite3.Database(path.join(__dirname, 'db.sqlite'));


// ---------- Statics (auto-detect) ----------


const CANDIDATES = [path.join(__dirname, 'public'), __dirname];
let STATIC_DIR = CANDIDATES[0];
for (const d of CANDIDATES) {
  const idx = path.join(d, 'index.html');
  if (fs.existsSync(idx)) {
    STATIC_DIR = d;
    break;
  }
}

app.use(express.json());
app.use(session({
  secret: 'tajna',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

app.use(express.static(STATIC_DIR));



// eksplicitno serviraj početnu da izbjegnemo "Cannot GET /"
app.get('/', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});



// ---------- DB init ----------
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name  TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`, () => {});

  db.run(`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      anime_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, anime_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS anime_cache (
      mal_id    INTEGER PRIMARY KEY,
      title     TEXT,
      image_url TEXT,
      score     REAL,
      status    TEXT,
      episodes  INTEGER,
      year      INTEGER,
      synopsis  TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
});


// ---------- Helpers ----------

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Prijavi se.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Prijavi se.' });
  }
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Samo za admina.' });
  }
  next();
}

function countAdmins() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) AS c FROM users WHERE role='admin'`, (err, row) => {
      if (err) {
        reject(err);
      } else {
        const count = row && typeof row.c !== 'undefined' ? row.c : 0;
        resolve(count);
      }
    });
  });
}

function getUserById(id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, first_name, last_name, email, role FROM users WHERE id=?`,
      [id],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}


// ---- Anime cache helpers ----

function getAnimeCacheById(malId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM anime_cache WHERE mal_id = ?`, [malId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

function upsertAnimeCache(row) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO anime_cache (mal_id, title, image_url, score, status, episodes, year, synopsis, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM anime_cache WHERE mal_id=?), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      ON CONFLICT(mal_id) DO UPDATE SET
        title=excluded.title,
        image_url=excluded.image_url,
        score=excluded.score,
        status=excluded.status,
        episodes=excluded.episodes,
        year=excluded.year,
        synopsis=excluded.synopsis,
        updated_at=CURRENT_TIMESTAMP
    `;
    const params = [
      row.mal_id, row.title, row.image_url, row.score, row.status, row.episodes, row.year, row.synopsis,
      row.mal_id
    ];
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}

async function fetchAnimeFullFromJikan(malId) {
  try {
    const resp = await fetch(`https://api.jikan.moe/v4/anime/${malId}/full`);
    if (!resp.ok) {
      return null;
    }
    const json = await resp.json();
    const a = json && json.data ? json.data : null;
    if (!a) {
      return null;
    }
    return {
      mal_id: Number(malId),
      title: a.title || '',
      image_url: (a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url)) || null,
      score: typeof a.score !== 'undefined' ? a.score : null,
      status: a.status || null,
      episodes: typeof a.episodes !== 'undefined' ? a.episodes : null,
      year: a.year || (a.aired && a.aired.prop && a.aired.prop.from && a.aired.prop.from.year ? a.aired.prop.from.year : null),
      synopsis: a.synopsis || null
    };
  } catch {
    return null;
  }
}

async function ensureCacheForAnime(malId) {
  const existing = await getAnimeCacheById(malId);
  if (existing) {
    return true;
  }
  const row = await fetchAnimeFullFromJikan(malId);
  if (!row) {
    return false;
  }
  await upsertAnimeCache(row);
  return true;
}




// ---------- Auth ----------  login, logout, register

app.post('/api/register', (req, res) => {
  const body = req.body || {};
  const first_name = body.first_name;
  const last_name = body.last_name;
  const email = body.email;
  const password = body.password;

  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ error: 'Popunite sva polja.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Lozinka mora imati barem 6 znakova.' });
  }

  const hash = bcrypt.hashSync(String(password), 10);

  db.serialize(() => {
    db.get(`SELECT COUNT(*) AS c FROM users`, (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'DB greška.' });
      }
      const role = row && row.c === 0 ? 'admin' : 'user';

      db.run(
        `INSERT INTO users (first_name, last_name, email, password_hash, role)
         VALUES (?, ?, ?, ?, ?)`,
        [String(first_name).trim(), String(last_name).trim(), String(email).toLowerCase().trim(), hash, role],
        function (err2) {
          if (err2) {
            return res.status(400).json({ error: 'Korisnik već postoji.' });
          }
          req.session.userId = this.lastID;
          req.session.role = role;
          res.json({ success: true, role: role });
        }
      );
    });
  });
});

app.post('/api/login', (req, res) => {
  const body = req.body || {};
  const email = body.email;
  const password = body.password;

  if (!email || !password) {
    return res.status(400).json({ error: 'Upišite email i lozinku.' });
  }

  db.get(
    `SELECT * FROM users WHERE email=?`,
    [String(email).toLowerCase().trim()],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'DB greška.' });
      }
      if (!row) {
        return res.status(401).json({ error: 'Pogrešan email ili lozinka.' });
      }
      const ok = bcrypt.compareSync(String(password), row.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'Pogrešan email ili lozinka.' });
      }
      req.session.userId = row.id;
      req.session.role = row.role || 'user';
      res.json({ success: true, role: req.session.role });
    }
  );
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});



//PROVJERAVANJE TKO JE ULOGIRAN
app.get('/api/user', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json(null);
  }
  db.get(
    `SELECT id, first_name, last_name, email, role FROM users WHERE id=?`,
    [req.session.userId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'DB greška.' });
      }
      res.json(row || null);
    }
  );
});


// ---------- Favorites ----------
app.get('/api/favorites', requireAuth, (req, res) => {
  db.all(
    `SELECT anime_id FROM favorites WHERE user_id=? ORDER BY created_at DESC`,
    [req.session.userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'DB greška.' });
      }
      const ids = Array.isArray(rows) ? rows.map(r => r.anime_id) : [];
      res.json(ids);
    }
  );
});
// ---------- Favorites ----------
app.post('/api/favorites', requireAuth, (req, res) => {
  const body = req.body || {};
  const anime_id = Number(body.anime_id);
  if (!Number.isFinite(anime_id) || anime_id <= 0) {
    return res.status(400).json({ error: 'Pogrešan anime_id.' });
  }

  db.run(
    `INSERT OR IGNORE INTO favorites (user_id, anime_id) VALUES (?, ?)`,
    [req.session.userId, anime_id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Greška pri spremanju.' });
      }
      ensureCacheForAnime(anime_id)
        .then(() => res.json({ success: true }))
        .catch(() => res.json({ success: true }));
    }
  );
});

app.delete('/api/favorites', requireAuth, (req, res) => {
  const body = req.body || {};
  const anime_id = Number(body.anime_id);
  if (!Number.isFinite(anime_id) || anime_id <= 0) {
    return res.status(400).json({ error: 'Pogrešan anime_id.' });
  }

  db.run(
    `DELETE FROM favorites WHERE user_id=? AND anime_id=?`,
    [req.session.userId, anime_id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Greška pri brisanju.' });
      }
      res.json({ success: true });
    }
  );
});
// Fallback dohvat iz lokalnog cachea (za frontend)
app.get('/api/anime-cache/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Pogrešan id.' });
  }
  try {
    const row = await getAnimeCacheById(id);
    if (!row) {
      return res.status(404).json({ error: 'Nema cache zapisa.' });
    }
    res.json(row);
  } catch {
    res.status(500).json({ error: 'Greška.' });
  }
});








// ---------- Admin API ----------


//ucitavanje usera iz baze
app.get('/api/admin/users', requireAdmin, (req, res) => {
  db.all(
    `SELECT id, first_name, last_name, email, role, created_at
     FROM users ORDER BY created_at DESC, id DESC`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'DB greška.' });
      }
      res.json(rows || []);
    }
  );
});




// --- ADMIN: lista cached anime zapisa ---
app.get('/api/admin/anime-cache', requireAdmin, (req, res) => {
  const sql = `SELECT mal_id, title, updated_at FROM anime_cache ORDER BY updated_at DESC`;
  db.all(sql, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Greška.' });
    }
    res.json(rows || []);
  });
});


// --- ADMIN: obriši jedan cache zapis ---
app.delete('/api/admin/anime-cache/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Pogrešan id.' });
  }

  db.run(`DELETE FROM anime_cache WHERE mal_id = ?`, [id], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Greška pri brisanju.' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Cache zapis nije pronađen.', deleted_cache: 0 });
    }
    return res.json({ success: true, deleted_cache: this.changes });
  });
});



//promjena uloge 

app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  const body = req.body || {};
  const role = body.role;

  if (!Number.isFinite(targetId)) {
    return res.status(400).json({ error: 'Neispravan korisnik.' });
  }
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Neispravna uloga.' });
  }

  try {
    const target = await getUserById(targetId);
    if (!target) {
      return res.status(404).json({ error: 'Korisnik ne postoji.' });
    }

    if (target.role === 'admin' && role === 'user') {
      const admins = await countAdmins();
      if (admins <= 1) {
        return res.status(400).json({ error: 'Ne možeš demotirati zadnjeg admina.' });
      }
    }

    db.run(`UPDATE users SET role=? WHERE id=?`, [role, targetId], function (err) {
      if (err) {
        return res.status(500).json({ error: 'DB greška.' });
      }
      if (req.session.userId === targetId) {
        req.session.role = role;
      }
      res.json({ success: true });
    });
  } catch (e) {
    res.status(500).json({ error: 'Neočekivana greška.' });
  }
});



//brisanje korisnika

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isFinite(targetId)) {
    return res.status(400).json({ error: 'Neispravan korisnik.' });
  }

  try {
    if (req.session.userId === targetId) {
      return res.status(400).json({ error: 'Ne možeš obrisati vlastiti račun.' });
    }
    const target = await getUserById(targetId);
    if (!target) {
      return res.status(404).json({ error: 'Korisnik ne postoji.' });
    }

    if (target.role === 'admin') {
      const admins = await countAdmins();
      if (admins <= 1) {
        return res.status(400).json({ error: 'Ne možeš obrisati zadnjeg admina.' });
      }
    }

    db.serialize(() => {
      db.run(`DELETE FROM favorites WHERE user_id=?`, [targetId]);
      db.run(`DELETE FROM users WHERE id=?`, [targetId], function (err) {
        if (err) {
          return res.status(500).json({ error: 'DB greška.' });
        }
        res.json({ success: true });
      });
    });
  } catch (e) {
    res.status(500).json({ error: 'Neočekivana greška.' });
  }
});


// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Serving static from:', STATIC_DIR);
  console.log(`Server radi na http://localhost:${PORT}`);
});
