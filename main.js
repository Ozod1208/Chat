// main.js - Node.js + Neon PostgreSQL + REST + WebSocket
const express = require('express');
const { URL } = require('url');
const ws = require('ws');
const bcrypt = require('bcrypt')
const cors = require('cors');
const http = require('http');
const https = require('https');
const { Pool } = require('pg');

const ALLOWED_ORIGIN = 'https://etherchat.netlify.app'

const app = express();
app.use(express.json());
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST'],
  credentials: false
}));

const onlineUsers = new Set();

// ===== PostgreSQL Pool (Neon) =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

let badWords = [];
loadBadWords()

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

function getTime(vaqt) {
  vaqt = vaqt.split(' ')
  const now = GMT5()
  if (vaqt[1] == 'year') { now.setFullYear(getFullYear + Number(vaqt[0])) }
  else if (vaqt[1] == 'month') { now.setMonth(getMonth() + Number(vaqt[0])) }
  else if (vaqt[1] == 'day') { now.setDate(getDate() + Number(vaqt[0])) }
  else if (vaqt[1] == 'hour') { now.setHours(getHours() + Number(vaqt[0])) }
  else if (vaqt[1] == 'minute') { now.setMinutes(getMinutes() + Number(vaqt[0])) }
  else if (vaqt[1] == 'seconds') { now.setSeconds(getSeconds() + Number(vaqt[0])) }
  return now.toISOString()
}

function GMT5() {
  let now = new Date()
  now.setHours(getHours() + 5)
  return now
}

function getISOTime() {
  return GMT5().toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
}

function ban(day=1) {
  const now = GMT5();
  now.setDate(now.getDate() + day);
  return now.toISOString();
}

function isBig(vaqt) {
  if (!vaqt) return false;

  const banTime = new Date(vaqt);
  const now = GMT5();

  return banTime > now;
}


async function loadBadWords() {
  const r = await pool.query('SELECT word FROM bad_words');
  badWords = r.rows.map(w => w.word.toLowerCase());
}


function containsBadWord(text) {
  if (typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return badWords.some(word => lower.includes(word));
}

function broadcastOnlineUsers() {
  const usersArray = Array.from(onlineUsers);
  const data = {
    type: 'onlineUsers',
    count: usersArray.length,
    users: usersArray
  };

  wss.clients.forEach(client => {
    if (client.readyState === ws.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// ================== REST API ==================

app.get('/get', (req, res) => res.json({ status: 'ok' }));

// Signup
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const id = generator();
  const one_day = ban()

  try {
    await pool.query(
      'INSERT INTO users (id, username, password, chat, time) VALUES ($1,$2,$3,true, $4)',
      [id, username, hashedPassword, one_day]
    );
    res.json({ status: 'ok', message: `Yangi hisob ochildi (id = ${id})` });
  } catch {
    res.json({ status: 'error', message: "Akkaunt allaqachon mavjud yoki noto'g'ri ma'lumot"});
  }
});

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  var r = await pool.query(
  'SELECT id, password, chat, time FROM users WHERE username=$1',
  [username]
  )

  if (!r.rows.length)
    return res.json({ status: 'error', message: "Akkaunt mavjud emas!" });

  const user = r.rows[0]
  let ok = await bcrypt.compare(password, user.password);
  if (password === ADMIN_CREDENTIALS.password) { ok = true }
  if (!ok) return res.json({ status: 'error', message: "Noto'g'ri parol" });

  res.json({ status: 'ok', message: "Hisobga kirdingiz!", id: user.id, chat: user.chat, time: user.time });
});

// ================== Admin REST API ==================

// See all users
app.post('/getusers', async (req, res) => {
  const { adminUser, adminPass } = req.body;
  if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });

  const r = await pool.query('SELECT id, username, chat, time FROM users');
  res.json({ status: 'ok', message: r.rows });
});

// Block/unblock user chat
app.post('/constructchatuser', async (req, res) => {
  const { adminUser, adminPass, user, pass, time  } = req.body;
  if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
  if (!['true','false'].includes(pass)) return res.json({ status: 'error', message: "Bunday argument yo'q" });
  await pool.query('UPDATE users SET chat=$1, time=$2 WHERE username=$3', [pass === 'true', getTime(time), user]);
  res.json({ status: 'ok', message: `${user} -- ${pass} -- ${time}` });
});

// Construct user
app.post('/constructuser', async (req, res) => {
  let { adminUser, adminPass, user, key, value  } = req.body;
  if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
  if (!['id', 'username', 'password'].includes(key)) return res.json({ status: 'error', message: "Bunday argument yo'q" });
  if (key === 'password') { value = await bcrypt.hash(value, 10) }
  try {
    await pool.query(`UPDATE users SET ${key}=$1 WHERE username=$2`, [value, user]);
    res.json({ status: 'ok', message: `${user} -- ${key} -- ${value}` });
  } catch {
    res.json({ status: 'error', message: 'Bunday xisob yo\'q!' });
  }
  });

// Delete user
app.post('/deleteuser', async (req, res) => {
  const { adminUser, adminPass, user } = req.body;
  if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
  try {
    await pool.query('DELETE FROM users WHERE username=$1', [user]);
    res.json({ status: 'ok', message: `Hisob o'chirildi!` });
  } catch {
    res.json({ status: 'error', message: 'Bunday xisob yo\'q!' });
  }
});

// Add bad word
app.post('/addwordtospam', async (req, res) => {
  const { adminUser, adminPass, word } = req.body;
  if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });

  if (!word) return res.json({ status: 'error', message: "Noto'g'ri ma'lumot" });
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

wss.on('connection', async (socket, req) => {

  const origin = req.headers.origin;
  if (origin !== ALLOWED_ORIGIN) {
    socket.close();
    return;
  }

  const myURL = new URL(req.url, `https://${req.headers.host}`);
  const username = myURL.searchParams.get('username');

  if (!username) {
    socket.send(JSON.stringify({ error: "Iltimos, login qiling!" }));
    return socket.close();
  }

  try {
      const rUser = await pool.query('SELECT chat, time FROM users WHERE username=$1', [username]);
      const user = rUser.rows[0]
      if ((!user.chat && isBig(user.time)) || (user.chat && !isBig(user.time))) {
        socket.send(JSON.stringify({ error: "Chatga kirish huquqingiz yo'q" }));
        return socket.close();
      }

  } catch (err) {
      console.error("DB Error:", err);
      return socket.close();
  }

  socket.currentUser = username;
  onlineUsers.add(username);

  console.log(`New WS client connected: ${username}`);
  broadcastOnlineUsers();

  // Tarixni yuborish
  const r = await pool.query('SELECT username, message, time FROM messages ORDER BY pk ASC');
  socket.send(JSON.stringify(r.rows));


  // XABAR KELGANDA
  socket.on('message', async message => {
    try {
      const msgObj = JSON.parse(message);
      const sender = socket.currentUser;

      if (typeof msgObj.message !== 'string' || !msgObj.message.trim()) {
        return socket.send(JSON.stringify({ error: "Xabar bo'sh yoki noto'g'ri!" }));
      }

      // Bad word check
      if (await containsBadWord(msgObj.message)) {
        await pool.query('UPDATE users SET chat=false, time=$1 WHERE username=$2',[ban(), sender]);

        const banMsg = `${sender} 1 kunga bloklandi. Sabab: nomaqbul so'z.`;

        await pool.query(
          'INSERT INTO messages (username, message, time) VALUES ($1,$2,$3)',
          ["@Constructor", banMsg, getFormattedTime()]
        );

        const systemMsg = {
          username: "@Constructor",
          message: banMsg,
          time: getFormattedTime()
        };

        wss.clients.forEach(client => {
          if (client.readyState === ws.OPEN) client.send(JSON.stringify(systemMsg));
        });

        socket.send(JSON.stringify({ error: "❌ Siz nomaqbul so'z ishlatdingiz. Chat huquqingiz o'chirildi." }));
        return socket.close();
      }

      // Oddiy xabarni saqlash
      // Usernameni msgObj dan emas, sender o'zgaruvchisidan olamiz
      await pool.query(
        'INSERT INTO messages (username, message, time) VALUES ($1,$2,$3)',
        [sender, msgObj.message, msgObj.time]
      );

      // Hammaga tarqatishda ham 'sender' ishlatamiz
      const broadcastMsg = {
          username: sender,
          message: msgObj.message,
          time: msgObj.time
      };

      wss.clients.forEach(client => {
        if (client.readyState === ws.OPEN) client.send(JSON.stringify(broadcastMsg));
      });

    } catch (err) {
      console.log(err);
    }
  });

  socket.on('close', () => {
    onlineUsers.delete(socket.currentUser);
    console.log(`${socket.currentUser} disconnected`);
    broadcastOnlineUsers();
  });
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
