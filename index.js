const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/public')));

const JWT_SECRET = 'tiranga_secret_2024';
const ADMIN_PASSWORD = 'admin123'; // Change this!
const ROUND_DURATION = 60; // seconds

// ─── In-Memory DB ───────────────────────────────────────────────
let users = {}; // { username: { id, username, passwordHash, balance, totalBet, totalWin } }
let rounds = []; // history
let currentRound = {
  id: 1,
  bets: {}, // { userId: { color, number, amount, username } }
  timeLeft: ROUND_DURATION,
  phase: 'betting', // 'betting' | 'result'
  result: null,
};
let clients = {}; // { ws: { userId, username, isAdmin } }

// ─── Number → Color mapping (Tiranga style) ─────────────────────
// 0 = Violet+Red, 5 = Violet+Green, 1,3,7,9 = Red, 2,4,6,8 = Green
function getNumberColor(n) {
  if (n === 0) return ['violet', 'red'];
  if (n === 5) return ['violet', 'green'];
  if ([1, 3, 7, 9].includes(n)) return ['red'];
  return ['green'];
}

// ─── Broadcast helpers ───────────────────────────────────────────
function broadcast(data, filter = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      if (!filter || filter(clients[ws])) ws.send(msg);
    }
  });
}

function sendTo(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function broadcastGameState() {
  const publicBets = Object.values(currentRound.bets).length;
  const totalPool = Object.values(currentRound.bets).reduce((s, b) => s + b.amount, 0);
  broadcast({
    type: 'gameState',
    round: currentRound.id,
    phase: currentRound.phase,
    timeLeft: currentRound.timeLeft,
    result: currentRound.result,
    totalBets: publicBets,
    totalPool,
  });
}

function broadcastAdminState() {
  const adminData = {
    type: 'adminState',
    round: currentRound.id,
    phase: currentRound.phase,
    timeLeft: currentRound.timeLeft,
    bets: Object.values(currentRound.bets),
    totalPool: Object.values(currentRound.bets).reduce((s, b) => s + b.amount, 0),
    players: Object.values(users).map(u => ({
      id: u.id, username: u.username,
      balance: u.balance, totalBet: u.totalBet, totalWin: u.totalWin
    })),
    history: rounds.slice(-20).reverse(),
  };
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && clients[ws]?.isAdmin) {
      ws.send(JSON.stringify(adminData));
    }
  });
}

// ─── Game Timer ──────────────────────────────────────────────────
let timerInterval = setInterval(() => {
  if (currentRound.phase !== 'betting') return;
  currentRound.timeLeft--;
  broadcastGameState();
  if (currentRound.timeLeft <= 0) {
    currentRound.phase = 'waiting';
    broadcast({ type: 'waitingForResult', round: currentRound.id });
    broadcastAdminState();
  }
}, 1000);

// Admin triggers result
function resolveRound(resultColor, resultNumber) {
  if (currentRound.phase === 'betting') {
    currentRound.phase = 'waiting';
  }
  const numColors = getNumberColor(resultNumber);
  currentRound.result = { color: resultColor, number: resultNumber, numColors };

  // Calculate payouts
  const payouts = [];
  Object.entries(currentRound.bets).forEach(([userId, bet]) => {
    const user = users[userId];
    if (!user) return;

    let multiplier = 0;
    let winType = '';

    const colorMatch = bet.color === resultColor;
    const numberMatch = bet.number === resultNumber;
    const numColorMatch = numColors.includes(bet.color);

    if (bet.betType === 'number' && numberMatch) {
      multiplier = 9;
      winType = 'Number match!';
    } else if (bet.betType === 'color') {
      if (colorMatch || numColorMatch) {
        if (resultColor === 'violet' || numColors.includes('violet')) {
          multiplier = 1.5;
          winType = 'Color match (Violet)!';
        } else {
          multiplier = 2;
          winType = 'Color match!';
        }
      }
    } else if (bet.betType === 'both') {
      if (numberMatch) {
        multiplier = 9;
        winType = 'Number match!';
      } else if (colorMatch || numColorMatch) {
        multiplier = 2;
        winType = 'Color match!';
      }
    }

    const payout = Math.floor(bet.amount * multiplier);
    user.balance += payout;
    user.totalWin += payout;

    payouts.push({ userId, username: bet.username, amount: bet.amount, payout, winType, multiplier });

    // Notify player
    const playerWs = [...wss.clients].find(ws => clients[ws]?.userId === userId);
    if (playerWs) {
      sendTo(playerWs, {
        type: 'betResult',
        payout,
        multiplier,
        winType: winType || 'No match',
        balance: user.balance,
        result: currentRound.result,
      });
    }
  });

  // Save round
  rounds.push({
    id: currentRound.id,
    result: currentRound.result,
    bets: Object.values(currentRound.bets),
    payouts,
    totalPool: Object.values(currentRound.bets).reduce((s, b) => s + b.amount, 0),
    totalPayout: payouts.reduce((s, p) => s + p.payout, 0),
    timestamp: new Date().toISOString(),
  });

  broadcast({ type: 'roundResult', result: currentRound.result, round: currentRound.id });
  broadcastAdminState();

  // Next round after 5s
  setTimeout(() => {
    currentRound = {
      id: currentRound.id + 1,
      bets: {},
      timeLeft: ROUND_DURATION,
      phase: 'betting',
      result: null,
    };
    broadcast({ type: 'newRound', round: currentRound.id });
    broadcastGameState();
    broadcastAdminState();
  }, 5000);
}

// ─── WebSocket ───────────────────────────────────────────────────
wss.on('connection', (ws) => {
  clients[ws] = { userId: null, username: null, isAdmin: false };

  sendTo(ws, { type: 'connected', message: 'Welcome to 07 Winn Game!' });
  sendTo(ws, {
    type: 'gameState',
    round: currentRound.id,
    phase: currentRound.phase,
    timeLeft: currentRound.timeLeft,
    result: currentRound.result,
    totalBets: Object.values(currentRound.bets).length,
    totalPool: Object.values(currentRound.bets).reduce((s, b) => s + b.amount, 0),
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── ADMIN LOGIN ──
    if (msg.type === 'adminLogin') {
      if (msg.password === ADMIN_PASSWORD) {
        clients[ws].isAdmin = true;
        sendTo(ws, { type: 'adminLoginSuccess' });
        broadcastAdminState();
      } else {
        sendTo(ws, { type: 'error', message: 'Wrong admin password' });
      }
      return;
    }

    // ── PLAYER REGISTER ──
    if (msg.type === 'register') {
      const { username, password } = msg;
      if (!username || !password) return sendTo(ws, { type: 'error', message: 'Username/password required' });
      if (users[username]) return sendTo(ws, { type: 'error', message: 'Username taken' });
      const hash = bcrypt.hashSync(password, 8);
      const id = uuidv4();
      users[username] = { id, username, passwordHash: hash, balance: 1000, totalBet: 0, totalWin: 0 };
      const token = jwt.sign({ id, username }, JWT_SECRET);
      clients[ws] = { userId: id, username, isAdmin: false };
      sendTo(ws, { type: 'loginSuccess', username, balance: 1000, token });
      broadcastAdminState();
      return;
    }

    // ── PLAYER LOGIN ──
    if (msg.type === 'login') {
      const { username, password } = msg;
      const user = users[username];
      if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
        return sendTo(ws, { type: 'error', message: 'Invalid credentials' });
      }
      const token = jwt.sign({ id: user.id, username }, JWT_SECRET);
      clients[ws] = { userId: user.id, username, isAdmin: false };
      sendTo(ws, { type: 'loginSuccess', username, balance: user.balance, token });
      return;
    }

    // ── PLACE BET ──
    if (msg.type === 'placeBet') {
      const client = clients[ws];
      if (!client.userId) return sendTo(ws, { type: 'error', message: 'Not logged in' });
      if (currentRound.phase !== 'betting') return sendTo(ws, { type: 'error', message: 'Betting closed!' });
      if (currentRound.bets[client.userId]) return sendTo(ws, { type: 'error', message: 'Already bet this round' });

      const user = users[client.username];
      const amount = parseInt(msg.amount);
      if (!amount || amount <= 0 || amount > user.balance) {
        return sendTo(ws, { type: 'error', message: 'Invalid bet amount' });
      }

      user.balance -= amount;
      user.totalBet += amount;

      currentRound.bets[client.userId] = {
        userId: client.userId,
        username: client.username,
        color: msg.color || null,
        number: msg.number !== undefined ? parseInt(msg.number) : null,
        betType: msg.betType || 'color',
        amount,
      };

      sendTo(ws, { type: 'betPlaced', balance: user.balance, amount, color: msg.color, number: msg.number });
      broadcastGameState();
      broadcastAdminState();
      return;
    }

    // ── ADMIN: SET RESULT ──
    if (msg.type === 'adminSetResult') {
      if (!clients[ws].isAdmin) return sendTo(ws, { type: 'error', message: 'Unauthorized' });
      resolveRound(msg.color, parseInt(msg.number));
      return;
    }

    // ── ADMIN: ADD BALANCE ──
    if (msg.type === 'adminAddBalance') {
      if (!clients[ws].isAdmin) return sendTo(ws, { type: 'error', message: 'Unauthorized' });
      const user = Object.values(users).find(u => u.username === msg.username);
      if (!user) return sendTo(ws, { type: 'error', message: 'User not found' });
      user.balance += parseInt(msg.amount);
      sendTo(ws, { type: 'adminSuccess', message: `Added ₹${msg.amount} to ${msg.username}` });
      broadcastAdminState();
      // Notify player
      const playerWs = [...wss.clients].find(w => clients[w]?.userId === user.id);
      if (playerWs) sendTo(playerWs, { type: 'balanceUpdate', balance: user.balance });
      return;
    }

    // ── ADMIN: REMOVE BALANCE ──
    if (msg.type === 'adminRemoveBalance') {
      if (!clients[ws].isAdmin) return sendTo(ws, { type: 'error', message: 'Unauthorized' });
      const user = Object.values(users).find(u => u.username === msg.username);
      if (!user) return sendTo(ws, { type: 'error', message: 'User not found' });
      user.balance = Math.max(0, user.balance - parseInt(msg.amount));
      sendTo(ws, { type: 'adminSuccess', message: `Removed ₹${msg.amount} from ${msg.username}` });
      broadcastAdminState();
      return;
    }

    // ── ADMIN: RESET PLAYER BALANCE ──
    if (msg.type === 'adminResetBalance') {
      if (!clients[ws].isAdmin) return sendTo(ws, { type: 'error', message: 'Unauthorized' });
      const user = Object.values(users).find(u => u.username === msg.username);
      if (!user) return sendTo(ws, { type: 'error', message: 'User not found' });
      user.balance = parseInt(msg.amount) || 1000;
      sendTo(ws, { type: 'adminSuccess', message: `Reset ${msg.username} balance to ₹${user.balance}` });
      broadcastAdminState();
      return;
    }
  });

  ws.on('close', () => { delete clients[ws]; });
});

// ─── REST: History ───────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  res.json(rounds.slice(-50).reverse());
});

// ─── Serve frontend ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 07 Winn Game running on port ${PORT}`));
