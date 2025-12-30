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

const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USER,
  password: process.env.ADMIN_PASS
};


const DATA_FILE_1 = "data.json";
const DATA_FILE_2 = "chat.json";
const DATA_FILE_3 = "spam.json"

// ===== Helper functions =====
function readData(file) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
    try { return JSON.parse(fs.readFileSync(file, "utf-8")); } 
    catch { return []; }
}

function writeData(data, file) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function isAdmin(user, pass) { return user === ADMIN_CREDENTIALS.username && pass === ADMIN_CREDENTIALS.password; }
function generator() { let n = Math.round(Math.random() * 100000000); return String(n); }

function getFormattedTime() {
  const now = new Date();

  // Soat, minut, sekund
  let hh = String(now.getHours()).padStart(2, '0');
  hh = String(Number(hh) + 5)
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  // Kun, oy (3 harfli), yil
  const day = now.getDate();
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear();

  return `${hh}:${mm}:${ss} | ${day}-${month}-${year}`;
}

console.log(getFormattedTime());
// Misol: 00:00:01 | 30-Dec-2025


// For spam 
function containsBadWord(text) {
  if (typeof text !== 'string') return false;
  const BAD_WORDS = readData(DATA_FILE_3);
  const msg = text.toLowerCase();
  return Array.isArray(BAD_WORDS) && BAD_WORDS.some(word => msg.includes(word));
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
app.post('/appenduser', (req, res) => {
    const { adminUser, adminPass, newUsername, newPassword, newId, newChat } = req.body;
    if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
    let acc = readData(DATA_FILE_1)
    let user = {
        username: newUsername,
        password: newPassword,
        id: newId,
        chat: (newChat === 'false') ? 'false' : 'true'
    }
    if ((newUsername === '' || newUsername === null) || (newPassword === '' || newPassword === null)) 
        return res.json({status: 'error', message: "Ma'lumot noto'g'ri"})
    if (user.id === '' || user.id === null) 
        user.id = generator()
    acc.push(user);
    writeData(acc, DATA_FILE_1)
    res.json({status: 'ok', message: `Xisob ochildi: \n ${user.username}  |  ${user.password}  |  ${user.id}  |  ${user.chat}`})
})

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

app.post('/appendwordtospam', (req, res) => {
    const { adminUser, adminPass, word } = req.body;
    if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
    if (word === '' || word === null) return res.json({status: 'error', message: "Noto'g'ri ma'lumot"})
    let spam = readData(DATA_FILE_3)
    spam.push(word)
    writeData(spam, DATA_FILE_3)
    res.json({status: 'ok', message: "So'z qo'shildi"})
})

app.post('/deletechat', (req, res) => {
    const { adminUser, adminPass } = req.body;
    if (!isAdmin(adminUser, adminPass)) return res.json({ status: 'error', message: 'Kirish noqonuniy!' });
    let data = [
      {
            username: "@Constructor",
            message: "Chat yangilandi!",
            time: getFormattedTime() 
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

        if (typeof msgObj.message !== 'string' || !msgObj.message.trim()) {
          return socket.send(JSON.stringify({ error: "Xabar bo‘sh yoki noto‘g‘ri!" }));
        }
  
          
        // 🚫 BAD WORD CHECK
        if (containsBadWord(msgObj.message)) {
          user.chat = 'false';
          writeData(acc, DATA_FILE_1);

          const systemMsg = {
            username: "@Constructor",
            message: `${msgObj.username} bloklandi. Sabab: nomaqbul so‘z.`,
            time: msgObj.time
          };

          const chat = readData(DATA_FILE_2);
          chat.push(systemMsg);
          writeData(chat, DATA_FILE_2);

          // 🔥 HAMMAGA KO‘RSATISH
          wss.clients.forEach(client => {
            if (client.readyState === ws.OPEN) {
            client.send(JSON.stringify(systemMsg));
        }
      });

  // ❌ USERNI UZISH
  socket.send(JSON.stringify({
    error: "❌ Siz nomaqbul so‘z ishlatdingiz. Chat huquqingiz o‘chirildi."
  }));

  socket.close(); // 🔴 MUHIM

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
let data = [
      {
            username: "@Constructor",
            message: "Chat yangilandi!",
            time: getFormattedTime() 
      }
        ]
    writeData(data, DATA_FILE_2);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

// Self-ping for not sleep

setInterval(() => {
  https.get('https://chat-uyma.onrender.com/get', res => {
    console.log('Server pinged at', new Date(), 'Status:', res.statusCode);
  }).on('error', err => console.log('Ping error:', err.message));
}, 30000);

// Created by Ozod Tirkachev













