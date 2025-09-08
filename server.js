const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./db.sqlite');

// Middleware
app.use(express.json());
app.use(session({
  secret: 'tajna',                // promijeni u nešto privatno za produkciju
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// statički frontend (public/)
app.use(express.static('public'));

// Inicijalizacija baze
db.serialize(() => {
  // db.run(`DROP TABLE IF EXISTS users`);
  // db.run(`DROP TABLE IF EXISTS favorites`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS favorites (
    user_id  INTEGER NOT NULL,
    anime_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, anime_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
});

// ========== AUTH ==========

// Registracija
app.post('/api/register', (req, res) => {
  const { first_name, last_name, email, password } = req.body || {};
  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ error: 'Popunite sva polja.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Lozinka mora imati barem 6 znakova.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  db.run(
    `INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)`,
    [first_name.trim(), last_name.trim(), String(email).toLowerCase().trim(), hash],
    function (err) {
      if (err) {
        // UNIQUE constraint failed: users.email
        return res.status(400).json({ error: 'Korisnik već postoji.' });
      }
      req.session.userId = this.lastID;
      res.json({ success: true });
    }
  );
});

// Prijava
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Unesite email i lozinku.' });
  }

  db.get(`SELECT * FROM users WHERE email = ?`, [String(email).toLowerCase().trim()], (err, user) => {
    if (err) return res.status(500).json({ error: 'Greška baze.' });
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Neispravni podaci.' });
    }
    req.session.userId = user.id;
    res.json({ success: true });
  });
});

// Odjava
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Greška pri odjavi' });
    res.clearCookie('connect.sid'); // isto kao kod kolege
    res.json({ success: true });
  });
});

// Trenutni korisnik
app.get('/api/user', (req, res) => {
  if (!req.session.userId) return res.json(null);
  db.get(
    `SELECT id, first_name, last_name, email FROM users WHERE id = ?`,
    [req.session.userId],
    (err, user) => {
      if (err) return res.status(500).json({ error: 'Greška baze.' });
      res.json(user || null);
    }
  );
});

// ========== FAVORITES (★) ==========

// Dohvati sve anime_id za prijavljenog korisnika
app.get('/api/favorites', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Niste prijavljeni.' });
  db.all(
    `SELECT anime_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC`,
    [req.session.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Greška pri dohvatu.' });
      res.json((rows || []).map(r => r.anime_id));
    }
  );
});

// Dodaj u favorite
app.post('/api/favorites', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Niste prijavljeni.' });
  const anime_id = Number((req.body || {}).anime_id);
  if (!Number.isInteger(anime_id) || anime_id <= 0) {
    return res.status(400).json({ error: 'Pogrešan anime_id.' });
    }
  db.run(
    `INSERT OR IGNORE INTO favorites (user_id, anime_id) VALUES (?, ?)`,
    [req.session.userId, anime_id],
    function (err) {
      if (err) return res.status(500).json({ error: 'Greška pri spremanju.' });
      res.status(201).json({ success: true });
    }
  );
});

// Ukloni iz favorita 
app.delete('/api/favorites/:anime_id', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Niste prijavljeni.' });
  const anime_id = Number(req.params.anime_id);
  if (!Number.isInteger(anime_id) || anime_id <= 0) {
    return res.status(400).json({ error: 'Pogrešan anime_id.' });
  }
  db.run(
    `DELETE FROM favorites WHERE user_id = ? AND anime_id = ?`,
    [req.session.userId, anime_id],
    function (err) {
      if (err) return res.status(500).json({ error: 'Greška pri brisanju.' });
      res.json({ success: true });
    }
  );
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server radi na http://localhost:${PORT}`));