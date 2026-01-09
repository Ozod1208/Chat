// main.js - Node.js + Neon PostgreSQL + REST + WebSocket
const express = require('express');
const ws = require('ws');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// ===== PostgreSQL Pool (Neon) =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// ===== Admin credentials =====
const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USER ,
  password: process.env.ADMIN_PASS 
};

// ===== Helper functions =====
function isAdmin(user, pass) {
  return user === ADMIN_CREDENTIALS.username && pass === ADMIN_CREDENTIALS.password;
}

function generator() {
  return String(Math.floor(Math.random() * 100000000));
}

function getFormattedTime() {
  const now = new Date();
  let hh = String(now.getHours() + 5).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const day = now.getDate();
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear();
  return `${hh}:${mm}:${ss} | ${day}-${month}-${year}`;
}

// Bad word check
async function containsBadWord(text) {
  if (typeof text !== 'string') return false;
  const r = await pool.query('SELECT word FROM bad_words');
  const words = r.rows.map(w => w.word.toLowerCase());
  return words.some(word => text.toLowerCase().includes(word));
}

// ================== REST API ==================

// Get chat
app.get('/chat', async (req, res) => {
  const r = await pool.query('SELECT username, message, time FROM messages ORDER BY pk ASC');
  res.json(r.rows);
});

app.get('/get', (req, res) => res.json({ status: 'ok' }));

// Signup
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  const id = generator();

  try {
    await pool.query(
      'INSERT INTO users (id, username, password, chat) VALUES ($1,$2,$3,true)',
      [id, username, password]
    );
    res.json({ status: 'ok', message: `Yangi hisob ochildi (id = ${id})` });
  } catch {
    res.json({ status: 'error', message: 'Akkaunt allaqachon mavjud yoki noto‘g‘ri ma‘lumot' });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (password === ADMIN_CREDENTIALS.password) {
    const r = await pool.query(
    'SELECT id, chat FROM users WHERE username=$1',
    [username]
  )};
  else {
    const r = await pool.query(
    'SELECT id, chat FROM users WHERE username=$1 AND password=$2',
    [username, password]
  )};

  if (!r.rows.length)
    return res.json({ status: 'error', message: "Akkaunt mavjud emas yoki noto‘g‘ri ma‘lumot" });

  res.json({ status: 'ok', message: "Hisobga kirdingiz!", id: r.rows[0].id, chat: r.rows[0].chat });
});

// Read chat
app.post('/readchat', async (req, res) => {
  const { username, password } = req.body;
  const r = await pool.query(
    'SELECT id, chat FROM users WHERE username=$1 AND password=$2',
    [username, password]
  );

  if (!r.rows.length)
    return res.json({ status: 'error', message: "Akkaunt mavjud emas yoki noto‘g‘ri ma‘lumot" });

  if (!r.rows[0].chat)
    return res.json({ status: 'error', message: "Chatga kirish huquqingiz yo‘q" });

  const chat = await pool.query('SELECT username, message, time FROM messages ORDER BY pk ASC');
  res.json({ status: 'ok', message: chat.rows });
});

// ================== Admin REST API ==================

// See all users
app.post('/seeusers', async (req, res) => {
  const { adminUser, adminPass } = req.body;
  if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });

  const r = await pool.query('SELECT username, id, chat FROM users');
  res.json({ status: 'ok', message: r.rows });
});

// Block/unblock user chat
app.post('/rechatuser', async (req, res) => {
  const { adminUser, adminPass, user, pass } = req.body;
  if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
  if (!['true','false'].includes(pass)) return res.json({ status: 'error', message: "Bunday argument yo'q" });

  await pool.query('UPDATE users SET chat=$1 WHERE username=$2', [pass === 'true', user]);
  res.json({ status: 'ok', message: `${user} -- ${pass}` });
});

// Delete user
app.post('/deleteuser', async (req, res) => {
  const { adminUser, adminPass, user } = req.body;
  if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });

  await pool.query('DELETE FROM users WHERE username=$1', [user]);
  res.json({ status: 'ok', message: `Hisob o'chirildi!` });
});

// Add bad word
app.post('/appendwordtospam', async (req, res) => {
  const { adminUser, adminPass, word } = req.body;
  if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });

  if (!word) return res.json({ status: 'error', message: "Noto‘g‘ri ma‘lumot" });
  await pool.query('INSERT INTO bad_words (word) VALUES ($1) ON CONFLICT DO NOTHING', [word]);
  res.json({ status: 'ok', message: "So'z qo'shildi" });
});

// Delete all chat
app.post('/deletechat', async (req, res) => {
  const { adminUser, adminPass } = req.body;
  if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });

  await pool.query('DELETE FROM messages');
  await pool.query(
    'INSERT INTO messages (username, message, time) VALUES ($1,$2,$3)',
    ["@Constructor", "Chat yangilandi!", getFormattedTime()]
  );

  res.json({ status: 'ok', message: "Chat yangilandi!" });
});

// ================== HTTP + WebSocket ==================
const server = http.createServer(app);
const wss = new ws.Server({ server });

wss.on('connection', async socket => {
  console.log("New WS client connected");

  const r = await pool.query('SELECT username, message, time FROM messages ORDER BY pk ASC');
  socket.send(JSON.stringify(r.rows));

  socket.on('message', async message => {
    try {
      const msgObj = JSON.parse(message);
      const rUser = await pool.query('SELECT chat FROM users WHERE username=$1', [msgObj.username]);

      if (!rUser.rows.length || !rUser.rows[0].chat) {
        return socket.send(JSON.stringify({ error: "Chatga kirish huquqingiz yo‘q" }));
      }

      if (typeof msgObj.message !== 'string' || !msgObj.message.trim()) {
        return socket.send(JSON.stringify({ error: "Xabar bo‘sh yoki noto‘g‘ri!" }));
      }

      // Bad word check
      if (await containsBadWord(msgObj.message)) {
        await pool.query('UPDATE users SET chat=false WHERE username=$1', [msgObj.username]);
        await pool.query(
          'INSERT INTO messages (username, message, time) VALUES ($1,$2,$3)',
          ["@Constructor", `${msgObj.username} bloklandi. Sabab: nomaqbul so‘z.`, msgObj.time]
        );

        const systemMsg = {
          username: "@Constructor",
          message: `${msgObj.username} bloklandi. Sabab: nomaqbul so‘z.`,
          time: msgObj.time
        };

        wss.clients.forEach(client => {
          if (client.readyState === ws.OPEN) client.send(JSON.stringify(systemMsg));
        });

        socket.send(JSON.stringify({ error: "❌ Siz nomaqbul so‘z ishlatdingiz. Chat huquqingiz o‘chirildi." }));
        return socket.close();
      }

      // Insert normal message
      await pool.query(
        'INSERT INTO messages (username, message, time) VALUES ($1,$2,$3)',
        [msgObj.username, msgObj.message, msgObj.time]
      );

      wss.clients.forEach(client => {
        if (client.readyState === ws.OPEN) client.send(JSON.stringify(msgObj));
      });

    } catch (err) {
      console.log(err);
    }
  });

  socket.on('close', () => console.log("WS client disconnected"));
});

// Server port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

// Self-ping
setInterval(() => {
  https.get('https://chat-uyma.onrender.com/get', res => {
    console.log('Server pinged at', new Date(), 'Status:', res.statusCode);
  }).on('error', err => console.log('Ping error:', err.message));
}, 30000);
// Created by Ozod Tirkachev

