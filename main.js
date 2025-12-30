// main.js - Render-ready Node.js server (REST + WebSocket)

const express = require('express');
const ws = require('ws');
const cors = require('cors');
const fs = require('fs');
const http = require('http');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_CREDENTIALS = { username: "OZOD", password: "12082010" };
const DATA_FILE_1 = "data.json";
const DATA_FILE_2 = "chat.json";
const DATA_FILE_3 = "spam.json"

const BAD_WORDS = readData(DATA_FILE_3)

// ===== Helper functions =====
function readData(file) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
    try { return JSON.parse(fs.readFileSync(file, "utf-8")); } 
    catch { return []; }
}

function writeData(data, file) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function isAdmin(user, pass) { return user === ADMIN_CREDENTIALS.username && pass === ADMIN_CREDENTIALS.password; }
function generator() { let n = Math.round(Math.random() * 100000000); return String(n); }

// For spam 
function containsBadWord(text) {
  const msg = text.toLowerCase();
  return BAD_WORDS.some(word => msg.includes(word));
}

// ================== REST API ==================

// Get chat
app.get('/chat', (req, res) => { res.json(readData(DATA_FILE_2)); });

app.get('/get', (req, res) => { res.json({status: 'ok'}) });

// Signup
app.post('/signup', (req, res) => {
    const { username, password } = req.body;
    const acc = readData(DATA_FILE_1);
    if (!username || !password || acc.find(a => a.username === username)) {
        return res.json({ status: 'error', message: "Akkaunt allaqachon mavjud yoki noto'g'ri ma'lumot" });
    }
    let int = generator();
    while (acc.find(a => a.id === int) || Number(int) < 10000000) int = generator();
    acc.push({ ...req.body, id: int, chat: 'true' });
    writeData(acc, DATA_FILE_1);
    res.json({ status: 'ok', message: `Yangi hisob ochildi (id = ${int})` });
});

// Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const acc = readData(DATA_FILE_1);
    const user = acc.find(a => a.username === username && a.password === password);
    if (!user) return res.json({ status: 'error', message: "Akkaunt mavjud emas yoki noto'g'ri ma'lumot" });
    res.json({ status: 'ok', message: "Hisobga kirdingiz!", id: user.id, chat: user.chat });
});

// Read chat
app.post('/readchat', (req, res) => {
    const { username, password } = req.body;
    const acc = readData(DATA_FILE_1);
    const user = acc.find(a => a.username === username && a.password === password);
    if (!user) return res.json({ status: 'error', message: "Akkaunt mavjud emas yoki noto'g'ri ma'lumot" });
    if (user.chat !== 'true') return res.json({ status: 'error', message: "Chatga kirish huquqingiz yo'q" });
    const chat = readData(DATA_FILE_2) || [];
    res.json({ status: 'ok', message: chat });
});

// ================== Admin REST API ==================
app.post('/seeusers', (req, res) => {
    const { adminUser, adminPass } = req.body;
    if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
    res.json({ status: 'ok', message: readData(DATA_FILE_1) });
});

app.post('/rechatuser', (req, res) => {
    const { adminUser, adminPass, user, pass } = req.body;
    if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
    const acc = readData(DATA_FILE_1);
    const sser = acc.find(a => a.username === user);
    if (!sser) return res.json({ status: 'error', message: "Bunday hisob yo'q" });
    if (pass !== 'true' && pass !== 'false') return res.json({ status: 'error', message: "Bunday argument yo'q" });
    sser.chat = pass;
    writeData(acc, DATA_FILE_1);
    res.json({ status: 'ok', message: `${sser.username} -- ${sser.chat}` });
});

app.post('/reuser', (req, res) => {
    const { adminUser, adminPass, user, type, type_name } = req.body;
    if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
    const acc = readData(DATA_FILE_1);
    const sser = acc.find(a => a.username === user);
    if (!sser) return res.json({ status: 'error', message: "Bunday hisob yo'q" });
    if (!['username', 'password', 'id', 'chat'].includes(type)) return res.json({ status: 'error', message: "Bunday argument yo'q" });
    sser[type] = type_name;
    writeData(acc, DATA_FILE_1);
    res.json({ status: 'ok', message: `${type} -- ${type_name}` });
});

app.post('/deleteuser', (req, res) => {
    const { adminUser, adminPass, user } = req.body;
    if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
    let acc = readData(DATA_FILE_1);
    acc = acc.filter(a => a.username !== user);
    writeData(acc, DATA_FILE_1);
    res.json({ status: 'ok', message: `Hisob o'chirildi!` });
});

app.post('/deletechat', (req, res) => {
    const { adminUser, adminPass } = req.body;
    if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
    data = [
      {
            "username": "@Consructor",
            "message": "Chat yangilandi!",
            "time": "00:00:01 | 1-Dec-2025"
      }
        ]
    writeData(data, DATA_FILE_2);
    res.json({ status: 'ok', message: `Chat yangilandi!` });
});

// ================== HTTP + WebSocket ==================
const server = http.createServer(app);
const wss = new ws.Server({ server });

wss.on('connection', socket => {
    console.log("New WS client connected");
    const chat = readData(DATA_FILE_2);
    socket.send(JSON.stringify(chat));

    socket.on('message', message => {
      try {
        const msgObj = JSON.parse(message);
        const acc = readData(DATA_FILE_1);
        const user = acc.find(a => a.username === msgObj.username);

        if (!user || user.chat !== 'true') {
          return socket.send(JSON.stringify({ error: "Chatga kirish huquqingiz yo‘q" }));
        }

        // 🚫 BAD WORD CHECK
        if (containsBadWord(msgObj.message)) {
          user.chat = 'false';
          writeData(acc, DATA_FILE_1);

          socket.send(JSON.stringify({
            error: "❌ Nomaqbul so‘z ishlatildi! Chat huquqingiz o‘chirildi."
          }));

          return;
    }

    const chat = readData(DATA_FILE_2);
    chat.push({
      username: msgObj.username,
      message: msgObj.message,
      time: msgObj.time
    });
    writeData(chat, DATA_FILE_2);

    wss.clients.forEach(client => {
      if (client.readyState === ws.OPEN) {
        client.send(JSON.stringify({
          username: msgObj.username,
          message: msgObj.message,
          time: msgObj.time
        }));
      }
    });

  } catch (err) {
    console.log(err);
  }
});


    socket.on('close', () => console.log("WS client disconnected"));
});

// Render port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

// Self-ping for not sleep

setInterval(() => {
  https.get('https://chat-uyma.onrender.com/get', res => {
    console.log('Server pinged at', new Date(), 'Status:', res.statusCode);
  }).on('error', err => console.log('Ping error:', err.message));
}, 30000);

// Created by Ozod Tirkachev





