require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET harus diisi dengan string acak minimal 32 karakter.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL belum diisi. Buat database PostgreSQL lalu isi variabel ini.');
  process.exit(1);
}
const origins = (process.env.CLIENT_ORIGIN || '*').split(',').map(s => s.trim());
const corsOrigin = origins.includes('*') ? true : origins;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 5
});
const app = express();
const server = http.createServer(app);
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '32kb' }));
app.get('/', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'unme_online.html'));
});
const io = new Server(server, { cors: { origin: corsOrigin } });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(24) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id BIGINT NOT NULL REFERENCES users(id),
      recipient_id BIGINT NOT NULL REFERENCES users(id),
      body VARCHAR(4000) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, recipient_id, id);
  `);
}
function signUser(user) {
  return jwt.sign({ sub: String(user.id), username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}
function authToken(req, res, next) {
  const value = req.headers.authorization || '';
  try {
    if (!value.startsWith('Bearer ')) throw new Error('missing');
    req.user = jwt.verify(value.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa. Silakan masuk lagi.' });
  }
}
app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'U N M E', database: 'connected' }); }
  catch { res.status(503).json({ ok: false, service: 'U N M E', database: 'disconnected' }); }
});
app.post('/api/register', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username))
    return res.status(400).json({ error: 'Username harus 3–24 karakter: huruf, angka, atau garis bawah.' });
  if (password.length < 8 || password.length > 72)
    return res.status(400).json({ error: 'Kata sandi harus 8–72 karakter.' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query('INSERT INTO users (username,password_hash) VALUES ($1,$2) RETURNING id,username', [username, hash]);
    const user = result.rows[0];
    res.status(201).json({ token: signUser(user), user: { id: user.id, username: user.username } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username sudah digunakan.' });
    console.error('register error', e.message); res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});
app.post('/api/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  try {
    const result = await pool.query('SELECT id,username,password_hash FROM users WHERE username=$1', [username]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Username atau kata sandi salah.' });
    res.json({ token: signUser(user), user: { id: user.id, username: user.username } });
  } catch (e) { console.error('login error', e.message); res.status(500).json({ error: 'Terjadi kesalahan server.' }); }
});
app.get('/api/users', authToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id,username FROM users WHERE id <> $1 ORDER BY username LIMIT 100', [req.user.sub]);
    res.json({ users: result.rows });
  } catch (e) { console.error(e.message); res.status(500).json({ error: 'Gagal memuat pengguna.' }); }
});
app.get('/api/messages/:userId', authToken, async (req, res) => {
  const otherId = req.params.userId;
  if (!/^\d+$/.test(otherId)) return res.status(400).json({ error: 'ID pengguna tidak valid.' });
  try {
    const result = await pool.query(`
      SELECT m.id,m.sender_id AS "senderId",m.recipient_id AS "recipientId",m.body,
        m.created_at AS "createdAt",s.username AS "senderUsername"
      FROM messages m JOIN users s ON s.id=m.sender_id
      WHERE (m.sender_id=$1 AND m.recipient_id=$2) OR (m.sender_id=$2 AND m.recipient_id=$1)
      ORDER BY m.id DESC LIMIT 100`, [req.user.sub, otherId]);
    res.json({ messages: result.rows.reverse() });
  } catch (e) { console.error(e.message); res.status(500).json({ error: 'Gagal memuat pesan.' }); }
});
io.use((socket, next) => {
  try {
    if (!socket.handshake.auth?.token) throw new Error('missing');
    socket.user = jwt.verify(socket.handshake.auth.token, JWT_SECRET);
    next();
  } catch { next(new Error('Token tidak valid')); }
});
io.on('connection', socket => {
  const senderId = String(socket.user.sub);
  socket.join(`user:${senderId}`);
  socket.on('private_message', async payload => {
    const recipientId = String(payload?.recipientId || '');
    const body = String(payload?.body || '').trim();
    if (!/^\d+$/.test(recipientId) || recipientId === senderId) return;
    if (!body || body.length > 4000) return socket.emit('message_error', { error: 'Pesan harus 1–4000 karakter.' });
    try {
      const recipient = await pool.query('SELECT id FROM users WHERE id=$1', [recipientId]);
      if (!recipient.rowCount) return socket.emit('message_error', { error: 'Pengguna tidak ditemukan.' });
      const inserted = await pool.query(
        'INSERT INTO messages(sender_id,recipient_id,body) VALUES($1,$2,$3) RETURNING id,created_at AS "createdAt"',
        [senderId, recipientId, body]
      );
      const sender = await pool.query('SELECT username FROM users WHERE id=$1', [senderId]);
      const message = {
        id: inserted.rows[0].id, senderId, recipientId, body,
        createdAt: inserted.rows[0].createdAt, senderUsername: sender.rows[0].username
      };
      io.to(`user:${recipientId}`).emit('new_message', message);
      socket.emit('message_sent', message);
    } catch (e) {
      console.error('message error', e.message);
      socket.emit('message_error', { error: 'Pesan gagal disimpan. Coba lagi.' });
    }
  });
});
initDb().then(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`U N M E server listening on ${PORT}`));
}).catch(e => { console.error('Database initialization failed:', e.message); process.exit(1); });
