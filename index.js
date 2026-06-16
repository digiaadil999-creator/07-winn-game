const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(cors());
app.use(express.json());
const JWT_SECRET = 'tiranga_secret_2024';
const ADMIN_PASSWORD = 'admin123';
const ROUND_DURATION = 60;
let users = {};
let rounds = [];
let currentRound = {
id: 1, bets: {}, timeLeft: ROUND_DURATION, phase: 'betting', result: null,
};
let clients = {};
function getNumberColor(n) {
if (n === 0) return ['violet', 'red'];
if (n === 5) return ['violet', 'green'];
if ([1, 3, 7, 9].includes(n)) return ['red'];
return ['green'];
}
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
broadcast({ type: 'gameState', round: currentRound.id, phase: currentRound.phase, timeLeft: }
function broadcastAdminState() {
const adminData = {
type: 'adminState', round: currentRound.id, phase: currentRound.phase, timeLeft: currentRound.bets: Object.values(currentRound.bets),
totalPool: Object.values(currentRound.bets).reduce((s, b) => s + b.amount, 0),
players: Object.values(users).map(u => ({ id: u.id, username: u.username, balance: u.balance, history: rounds.slice(-20).reverse(),
};
wss.clients.forEach(ws => {
if (ws.readyState === WebSocket.OPEN && clients[ws] && clients[ws].isAdmin) ws.send(JSON.});
}
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
function resolveRound(resultColor, resultNumber) {
if (currentRound.phase === 'betting') currentRound.phase = 'waiting';
const numColors = getNumberColor(resultNumber);
currentRound.result = { color: resultColor, number: resultNumber, numColors };
const payouts = [];
let totalPayout = 0;
Object.entries(currentRound.bets).forEach(([userId, bet]) => {
const user = users[userId];
if (!user) return;
let multiplier = 0, winType = '';
const numColorMatch = numColors.includes(bet.color);
if (bet.betType === 'number' && bet.number === resultNumber) {
multiplier = 9; winType = 'Number match!';
} else if (bet.betType === 'color' || bet.betType === 'both') {
if (bet.number === resultNumber) { multiplier = 9; winType = 'Number match!'; }
else if (bet.color === resultColor || numColorMatch) {
if (resultColor === 'violet' || numColors.includes('violet')) { multiplier = 1.5; winType else { multiplier = 2; winType = 'Color match!'; }
}
}
const payout = Math.floor(bet.amount * multiplier);
user.balance += payout;
user.totalWin += payout;
totalPayout += payout;
payouts.push({ userId, username: bet.username, amount: bet.amount, payout, winType, multiplier const playerWs = [...wss.clients].find(ws => clients[ws] && clients[ws].userId === userId);
if (playerWs) sendTo(playerWs, { type: 'betResult', payout, multiplier, winType: winType });
rounds.push({ id: currentRound.id, result: currentRound.result, bets: Object.values(currentRound.broadcast({ type: 'roundResult', result: currentRound.result, round: currentRound.id });
broadcastAdminState();
setTimeout(() => {
currentRound = { id: currentRound.id + 1, bets: {}, timeLeft: ROUND_DURATION, phase: 'betting', broadcast({ type: 'newRound', round: currentRound.id });
broadcastGameState();
broadcastAdminState();
}, 5000);
}
wss.on('connection', (ws) => {
clients[ws] = { userId: null, username: null, isAdmin: false };
sendTo(ws, { type: 'connected' });
sendTo(ws, { type: 'gameState', round: currentRound.id, phase: currentRound.phase, timeLeft: ws.on('message', (raw) => {
let msg;
try { msg = JSON.parse(raw); } catch { return; }
if (msg.type === 'adminLogin') {
if (msg.password === ADMIN_PASSWORD) { clients[ws].isAdmin = true; sendTo(ws, { type: 'else sendTo(ws, { type: 'error', message: 'Wrong admin password' });
return;
}
if (msg.type === 'register') {
const { username, password } = msg;
if (!username || !password) return sendTo(ws, { type: 'error', message: 'Username/password if (users[username]) return sendTo(ws, { type: 'error', message: 'Username taken' });
const hash = bcrypt.hashSync(password, 8);
const id = uuidv4();
users[username] = { id, username, passwordHash: hash, balance: 1000, totalBet: 0, totalWin: clients[ws] = { userId: id, username, isAdmin: false };
sendTo(ws, { type: 'loginSuccess', username, balance: 1000 });
broadcastAdminState();
return;
}
if (msg.type === 'login') {
const { username, password } = msg;
const user = users[username];
if (!user || !bcrypt.compareSync(password, user.passwordHash)) return sendTo(ws, { type: clients[ws] = { userId: user.id, username, isAdmin: false };
sendTo(ws, { type: 'loginSuccess', username, balance: user.balance });
return;
}
if (msg.type === 'placeBet') {
const client = clients[ws];
if (!client.userId) return sendTo(ws, { type: 'error', message: 'Not logged in' });
if (currentRound.phase !== 'betting') return sendTo(ws, { type: 'error', message: 'Betting if (currentRound.bets[client.userId]) return sendTo(ws, { type: 'error', message: 'Already const user = users[client.username];
const amount = parseInt(msg.amount);
if (!amount || amount <= 0 || amount > user.balance) return sendTo(ws, { type: 'error', user.balance -= amount;
user.totalBet += amount;
currentRound.bets[client.userId] = { userId: client.userId, username: client.username, sendTo(ws, { type: 'betPlaced', balance: user.balance, amount, color: msg.color, number: broadcastGameState();
broadcastAdminState();
return;
}
if (msg.type === 'adminSetResult') {
if (!clients[ws].isAdmin) return sendTo(ws, { type: 'error', message: 'Unauthorized' });
resolveRound(msg.color, parseInt(msg.number));
return;
}
if (msg.type === 'adminAddBalance') {
if (!clients[ws].isAdmin) return;
const user = Object.values(users).find(u => u.username === msg.username);
if (!user) return;
user.balance += parseInt(msg.amount);
sendTo(ws, { type: 'adminSuccess', message: 'Added Rs.' + msg.amount + ' to ' + msg.username broadcastAdminState();
const playerWs = [...wss.clients].find(w => clients[w] && clients[w].userId === user.id);
if (playerWs) sendTo(playerWs, { type: 'balanceUpdate', balance: user.balance });
return;
}
if (msg.type === 'adminRemoveBalance') {
if (!clients[ws].isAdmin) return;
const user = Object.values(users).find(u => u.username === msg.username);
if (!user) return;
user.balance = Math.max(0, user.balance - parseInt(msg.amount));
sendTo(ws, { type: 'adminSuccess', message: 'Removed Rs.' + msg.amount + ' from ' + msg.broadcastAdminState();
return;
}
});
ws.on('close', () => { delete clients[ws]; });
});
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>07 Winn - Color Trading</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+*{margin:0;padding:0;box-sizing:border-box;}
:root{
--bg:#0d0d12;--surface:#16161f;--card:#1c1c28;--border:#252535;
--text:#f0f0fa;--muted:#6b6b85;--green:#25d366;--red:#ff4757;
--violet:#a855f7;--gold:#f5c542;--win:#2ecc71;--lose:#e74c3c;
}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;}
.screen{display:none;min-height:100vh;}
.screen.active{display:flex;flex-direction:column;}
#authScreen{align-items:center;justify-content:center;padding:24px;}
.auth-box{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:.auth-logo{text-align:center;margin-bottom:28px;}
.auth-logo h1{font-size:1.8rem;font-weight:800;letter-spacing:-1px;}
.auth-logo h1 span.g{color:var(--green);}
.auth-logo h1 span.r{color:var(--red);}
.auth-logo p{color:var(--muted);font-size:0.85rem;margin-top:4px;}
.tabs{display:flex;gap:4px;background:var(--card);border-radius:10px;padding:4px;margin-bottom:.tab-btn{flex:1;padding:9px;border-radius:7px;border:none;background:transparent;color:var(--.tab-btn.active{background:var(--border);color:var(--text);}
.input-group{margin-bottom:14px;}
.input-group label{display:block;font-size:0.78rem;color:var(--muted);margin-bottom:6px;text-.inp{width:100%;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-.inp:focus{border-color:var(--gold);}
.btn-primary{width:100%;padding:14px;background:var(--gold);color:#0d0d12;border:none;border-.error-msg{color:var(--lose);font-size:0.82rem;text-align:center;margin-top:10px;min-height:20px;}
.admin-link{text-align:center;margin-top:16px;font-size:0.82rem;color:var(--muted);}
.admin-link a{color:var(--gold);cursor:pointer;}
#gameScreen{max-width:480px;margin:0 auto;width:100%;}
.top-bar{background:var(--surface);border-bottom:1px solid var(--border);padding:14px 18px;display:.top-bar-logo{font-size:1.1rem;font-weight:800;}
.top-bar-logo span.g{color:var(--green);}
.top-bar-logo span.r{color:var(--red);}
.balance-chip{background:var(--card);border:1px solid var(--border);border-radius:99px;padding:.logout-btn{padding:7px 16px;background:transparent;border:1px solid var(--border);color:var(--.game-content{padding:14px;display:flex;flex-direction:column;gap:12px;}
.timer-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:.round-info{font-size:0.7rem;color:var(--muted);letter-spacing:2px;text-transform:uppercase;}
.round-number{font-size:2.2rem;font-weight:800;font-family:'Space Mono',monospace;color:var(--.timer-countdown{font-size:1rem;color:var(--muted);margin-top:4px;}
.timer-countdown span{color:var(--gold);font-family:'Space Mono',monospace;font-size:1.1rem;}
.progress-bar{margin-top:10px;height:5px;background:var(--border);border-radius:99px;overflow:.progress-fill{height:100%;border-radius:99px;background:var(--gold);transition:width 1s linear;}
.phase-badge{display:inline-block;margin-top:8px;padding:3px 12px;border-radius:99px;font-size:.phase-badge.betting{background:rgba(37,211,102,.15);color:var(--green);}
.phase-badge.waiting{background:rgba(245,197,66,.15);color:var(--gold);}
.result-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:.result-waiting{color:var(--muted);font-size:0.88rem;}
.result-balls{display:flex;gap:14px;align-items:center;justify-content:center;margin:12px 0;}
.result-ball{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-.result-ball.green{background:var(--green);}
.result-ball.red{background:var(--red);}
.result-ball.violet{background:var(--violet);}
.result-ball.mixed{background:linear-gradient(135deg,var(--violet),var(--red));}
.payout-result{padding:6px 20px;border-radius:99px;font-weight:700;font-size:0.95rem;display:.payout-result.win{background:rgba(46,204,113,.15);color:var(--win);}
.payout-result.lose{background:rgba(231,76,60,.15);color:var(--lose);}
.bet-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:.section-label{font-size:0.7rem;color:var(--muted);letter-spacing:2px;text-transform:uppercase;.color-btns{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
.color-btn{padding:14px 8px;border-radius:12px;border:3px solid transparent;cursor:pointer;text-.color-btn.green-btn{background:rgba(37,211,102,.2);color:var(--green);}
.color-btn.red-btn{background:rgba(255,71,87,.2);color:var(--red);}
.color-btn.violet-btn{background:rgba(168,85,247,.2);color:var(--violet);}
.color-btn.selected.green-btn{background:var(--green);color:#fff;}
.color-btn.selected.red-btn{background:var(--red);color:#fff;}
.color-btn.selected.violet-btn{background:var(--violet);color:#fff;}
.color-payout{display:block;font-size:0.68rem;font-weight:400;opacity:.8;margin-top:2px;}
.num-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;}
.num-btn{padding:12px 0;border-radius:10px;border:2px solid var(--border);background:var(--card);.num-btn.selected{border-color:var(--gold);background:rgba(245,197,66,.1);color:var(--gold);}
.num-btn.green-num{color:var(--green);}
.num-btn.red-num{color:var(--red);}
.num-btn.violet-num{color:var(--violet);}
.amt-chips{display:flex;flex-wrap:wrap;gap:7px;}
.amt-chip{padding:8px 16px;border-radius:99px;background:var(--card);border:1px solid var(--border);.amt-chip.selected{border-color:var(--gold);color:var(--gold);}
.custom-inp{flex:1;min-width:90px;padding:8px 14px;border-radius:99px;background:var(--card);.bet-summary{font-size:0.8rem;color:var(--muted);text-align:center;min-height:16px;}
.place-btn{width:100%;padding:15px;background:var(--gold);color:#0d0d12;border:none;border-radius:.place-btn:disabled{opacity:.3;cursor:not-allowed;}
.history-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:.history-dots{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}
.h-dot-item{display:flex;flex-direction:column;align-items:center;gap:3px;}
.h-circle{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:.h-circle.green{background:var(--green);}
.h-circle.red{background:var(--red);}
.h-circle.violet{background:var(--violet);}
.h-circle.mixed{background:linear-gradient(135deg,var(--violet),var(--red));}
.h-rnd{font-size:0.6rem;color:var(--muted);}
.payout-table{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:.payout-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-.payout-row:last-child{border:none;}
.payout-row .pay-val{font-family:'Space Mono',monospace;color:var(--gold);font-weight:700;}
#adminScreen{max-width:600px;margin:0 auto;width:100%;}
.admin-bar{background:var(--surface);border-bottom:1px solid var(--border);padding:14px 18px;.admin-bar h2{font-size:1rem;font-weight:700;color:var(--gold);}
.admin-content{padding:14px;display:flex;flex-direction:column;gap:12px;}
.admin-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:.admin-card h3{font-size:0.7rem;color:var(--muted);letter-spacing:2px;text-transform:uppercase;.result-setter{display:flex;flex-direction:column;gap:10px;}
.rs-colors{display:flex;gap:8px;}
.rs-btn{flex:1;padding:12px;border-radius:10px;border:2px solid transparent;cursor:pointer;font-.rs-btn.green{background:rgba(37,211,102,.15);color:var(--green);}
.rs-btn.red{background:rgba(255,71,87,.15);color:var(--red);}
.rs-btn.violet{background:rgba(168,85,247,.15);color:var(--violet);}
.rs-btn.selected.green{background:var(--green);color:#fff;}
.rs-btn.selected.red{background:var(--red);color:#fff;}
.rs-btn.selected.violet{background:var(--violet);color:#fff;}
.rs-nums{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;}
.rs-num{padding:12px 0;border-radius:8px;border:2px solid var(--border);background:var(--card);.rs-num.selected{border-color:var(--gold);color:var(--gold);}
.rs-set-btn{padding:14px;background:#e74c3c;color:#fff;border:none;border-radius:10px;font-weight:.rs-set-btn:disabled{opacity:.3;cursor:not-allowed;}
.admin-status{font-size:0.82rem;color:var(--muted);text-align:center;min-height:18px;}
.bets-list{display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;}
.bet-item{display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--card);border-.bet-color-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.bet-item .bi-amt{margin-left:auto;font-family:'Space Mono',monospace;color:var(--gold);}
.players-table{width:100%;border-collapse:collapse;font-size:0.82rem;}
.players-table th{text-align:left;padding:8px 10px;color:var(--muted);font-weight:600;border-.players-table td{padding:8px 10px;border-bottom:1px solid var(--border);}
.pl-actions{display:flex;gap:6px;}
.pl-btn{padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--card);.pl-btn.add{border-color:var(--green);color:var(--green);}
.pl-btn.remove{border-color:var(--red);color:var(--red);}
.pl-inp{width:60px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:.hist-table{width:100%;border-collapse:collapse;font-size:0.8rem;}
.hist-table th{text-align:left;padding:7px 8px;color:var(--muted);font-weight:600;border-bottom:.hist-table td{padding:7px 8px;border-bottom:1px solid var(--border);font-family:'Space Mono',.hist-profit{color:var(--win);}
.hist-loss{color:var(--lose);}
</style>
</head>
<body>
<div class="screen active" id="authScreen">
<div class="auth-box">
<div class="auth-logo">
<h1><span class="g">07</span> Wi<span class="r">nn</span></h1>
<p>Color Trading Game</p>
</div>
<div class="tabs">
<button class="tab-btn active" id="loginTab">Login</button>
<button class="tab-btn" id="registerTab">Register</button>
</div>
<div class="input-group"><label>Username</label><input class="inp" id="authUser" placeholder="<div class="input-group"><label>Password</label><input class="inp" type="password" id="authPass" <button class="btn-primary" id="authBtn">Login</button>
<div class="error-msg" id="authError"></div>
<div class="admin-link">Admin? <a id="adminLinkBtn" style="cursor:pointer;color:var(--gold)"></div>
</div>
<div class="screen" id="gameScreen">
<div class="top-bar">
<div class="top-bar-logo"><span class="g">07</span> Wi<span class="r">nn</span></div>
<div style="display:flex;align-items:center;gap:10px;">
<div class="balance-chip" id="playerBalance">Rs.0</div>
<button class="logout-btn" onclick="logout()">Logout</button>
</div>
</div>
<div class="game-content">
<div class="timer-card">
<div class="round-info">Round</div>
<div class="round-number" id="roundNum">1</div>
<div class="timer-countdown">Next draw in <span id="timerText">60s</span></div>
<div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:100%"></<span class="phase-badge betting" id="phaseBadge">Betting Open</span>
</div>
<div class="result-card" id="resultCard">
<div class="result-waiting">Waiting for draw result...</div>
</div>
<div class="bet-card">
<div>
<div class="section-label">Choose Color</div>
<div class="color-btns">
<div class="color-btn green-btn" onclick="selectColor('green',this)">Green<span class="<div class="color-btn violet-btn" onclick="selectColor('violet',this)">Violet<span <div class="color-btn red-btn" onclick="selectColor('red',this)">Red<span class="color-</div>
</div>
<div>
<div class="section-label">Choose Number (0-9)</div>
<div class="num-grid" id="numGrid"></div>
</div>
<div>
<div class="section-label">Bet Amount</div>
<div class="amt-chips">
<div class="amt-chip" onclick="selectAmt(10,this)">Rs.10</div>
<div class="amt-chip" onclick="selectAmt(50,this)">Rs.50</div>
<div class="amt-chip" onclick="selectAmt(100,this)">Rs.100</div>
<div class="amt-chip" onclick="selectAmt(500,this)">Rs.500</div>
<input class="custom-inp" id="customAmt" type="number" placeholder="Custom" oninput="</div>
</div>
<div class="bet-summary" id="betSummary">Pick color or number and amount to bet</div>
<button class="place-btn" id="placeBtn" disabled onclick="placeBet()">Place Bet</button>
</div>
<div class="payout-table">
<div class="section-label">Payout Rates</div>
<div class="payout-row"><span>Green / Red (color bet)</span><span class="pay-val">2x</span></<div class="payout-row"><span>Violet (color bet)</span><span class="pay-val">4.5x</span></<div class="payout-row"><span>Number (0-9)</span><span class="pay-val">9x</span></div>
<div class="payout-row"><span>0 or 5 (violet number)</span><span class="pay-val">1.5x</</div>
<div class="history-card">
<div class="section-label">Recent Results</div>
<div class="history-dots" id="historyDots">
<span style="color:var(--muted);font-size:0.82rem;">No results yet</span>
</div>
</div>
</div>
</div>
<div class="screen" id="adminScreen">
<div class="admin-bar">
<h2>07 Winn - Admin</h2>
<div style="display:flex;gap:8px;align-items:center;">
<span id="adminRoundInfo" style="font-size:0.8rem;color:var(--muted);font-family:'Space <button class="logout-btn" onclick="logout()">Logout</button>
</div>
</div>
<div class="admin-content">
<div class="admin-card">
<h3>Set Round Result</h3>
<div class="result-setter">
<div>
<div style="font-size:0.75rem;color:var(--muted);margin-bottom:8px;">SELECT COLOR</<div class="rs-colors">
<button class="rs-btn green" onclick="adminSelectColor('green',this)">Green</button>
<button class="rs-btn violet" onclick="adminSelectColor('violet',this)">Violet</button>
<button class="rs-btn red" onclick="adminSelectColor('red',this)">Red</button>
</div>
</div>
<div>
<div style="font-size:0.75rem;color:var(--muted);margin-bottom:8px;">SELECT NUMBER</<div class="rs-nums" id="adminNumGrid"></div>
</div>
<div class="admin-status" id="adminStatus">Select color + number, then set result</div>
<button class="rs-set-btn" id="setResultBtn" disabled onclick="adminSetResult()">Set </div>
</div>
<div class="admin-card">
<h3>Current Round Bets (<span id="betCount">0</span>) - Pool: <span id="poolAmt" style="<div class="bets-list" id="adminBetsList">
<span style="color:var(--muted);font-size:0.82rem;">No bets yet</span>
</div>
</div>
<div class="admin-card">
<h3>Players</h3>
<table class="players-table">
<thead><tr><th>Username</th><th>Balance</th><th>Total Bet</th><th>Manage</th></tr></thead>
<tbody id="playersTableBody"></tbody>
</table>
</div>
<div class="admin-card">
<h3>Round History</h3>
<div style="overflow-x:auto;">
<table class="hist-table">
<thead><tr><th>#</th><th>Result</th><th>Pool</th><th>Payout</th><th>Profit</th></tr></<tbody id="adminHistBody"></tbody>
</table>
</div>
</div>
</div>
</div>
<script>
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const ROUND_DURATION = 60;
const NUM_COLORS = {0:'violet',1:'red',2:'green',3:'red',4:'green',5:'violet',6:'green',7:'red',let ws, isAdmin=false, authMode='login';
let myBalance=0, myUsername='';
let selectedColor=null, selectedNumber=null, selectedAmt=null;
let betPlaced=false, currentPhase='betting';
let adminSelColor=null, adminSelNumber=null;
let roundDuration=ROUND_DURATION, roundTimeLeft=ROUND_DURATION, roundNum=1;
function connectWS(onOpen){
ws = new WebSocket(WS_URL);
ws.onopen = () => { if(onOpen) onOpen(); };
ws.onmessage = (e) => handleMsg(JSON.parse(e.data));
ws.onclose = () => setTimeout(()=>connectWS(), 2000);
}
function send(data){ if(ws && ws.readyState===1) ws.send(JSON.stringify(data)); }
function handleMsg(msg){
if(msg.type==='connected') return;
if(msg.type==='error'){ document.getElementById('authError').textContent = msg.message; return; if(msg.type==='loginSuccess'){
myUsername = msg.username; myBalance = msg.balance;
showScreen(isAdmin ? 'admin' : 'game'); return;
}
if(msg.type==='adminLoginSuccess'){ isAdmin = true; showScreen('admin'); return; }
if(msg.type==='gameState'){
roundNum = msg.round; roundTimeLeft = msg.timeLeft; currentPhase = msg.phase;
updateTimer(); updateGamePhaseUI(); return;
}
if(msg.type==='betPlaced'){
myBalance = msg.balance; updateBalance(); betPlaced = true;
document.getElementById('placeBtn').disabled = true;
document.getElementById('betSummary').textContent = 'Bet placed! Rs.' + msg.amount + ' - return;
}
if(msg.type==='waitingForResult'){ currentPhase = 'waiting'; updateGamePhaseUI(); return; }
if(msg.type==='betResult'){ myBalance = msg.balance; updateBalance(); showBetResult(msg); return; if(msg.type==='roundResult'){ showRoundResult(msg.result, msg.round); return; }
if(msg.type==='newRound'){
roundNum = msg.round; roundTimeLeft = roundDuration; currentPhase = 'betting'; betPlaced selectedColor = null; selectedNumber = null; selectedAmt = null;
resetBetUI(); updateTimer(); updateGamePhaseUI();
document.getElementById('resultCard').innerHTML = '<div class="result-waiting">Waiting for return;
}
if(msg.type==='balanceUpdate'){ myBalance = msg.balance; updateBalance(); return; }
if(msg.type==='adminState'){ updateAdminUI(msg); return; }
if(msg.type==='adminSuccess'){ document.getElementById('adminStatus').textContent = msg.message; }
function switchTab(mode){
authMode = mode;
document.querySelectorAll('.tab-btn').forEach((b,i)=>{
b.classList.toggle('active', (i===0&&mode==='login')||(i===1&&mode==='register'));
});
document.getElementById('authBtn').textContent = mode==='login' ? 'Login' : 'Register';
document.getElementById('authError').textContent = '';
}
function doAuth(){
const u = document.getElementById('authUser').value.trim();
const p = document.getElementById('authPass').value.trim();
if(!u||!p){ document.getElementById('authError').textContent='Fill all fields'; return; }
document.getElementById('authError').textContent='';
send({ type: authMode==='login'?'login':'register', username:u, password:p });
}
function showAdminLogin(){
const box = document.querySelector('.auth-box');
box.innerHTML = '<div class="auth-logo"><h1 style="color:var(--gold)">Admin Panel</h1><p>07 }
function doAdminLogin(){
const p = document.getElementById('adminPassInp').value;
send({ type:'adminLogin', password:p });
}
function logout(){ location.reload(); }
function showScreen(s){
document.querySelectorAll('.screen').forEach(sc=>sc.classList.remove('active'));
if(s==='game'){
document.getElementById('gameScreen').classList.add('active');
updateBalance(); buildNumGrid();
} else if(s==='admin'){
document.getElementById('adminScreen').classList.add('active');
buildAdminNumGrid();
} else {
document.getElementById('authScreen').classList.add('active');
}
}
function buildNumGrid(){
const grid = document.getElementById('numGrid');
grid.innerHTML = '';
for(let i=0;i<=9;i++){
const c = NUM_COLORS[i];
const btn = document.createElement('div');
btn.className = 'num-btn ' + c + '-num';
btn.textContent = i;
btn.onclick = () => selectNumber(i, btn);
grid.appendChild(btn);
}
}
function updateBalance(){
document.getElementById('playerBalance').textContent = 'Rs.' + myBalance.toLocaleString('en-}
function updateTimer(){
document.getElementById('roundNum').textContent = roundNum;
document.getElementById('timerText').textContent = roundTimeLeft + 's';
const pct = (roundTimeLeft / roundDuration) * 100;
const fill = document.getElementById('progressFill');
fill.style.width = pct + '%';
fill.style.background = roundTimeLeft<=5?'var(--red)':roundTimeLeft<=10?'#e67e22':'var(--gold)';
}
function updateGamePhaseUI(){
const badge = document.getElementById('phaseBadge');
badge.className = 'phase-badge ' + currentPhase;
if(currentPhase==='betting') badge.textContent='Betting Open';
else if(currentPhase==='waiting') badge.textContent='Draw Pending...';
if(currentPhase!=='betting'){
document.getElementById('placeBtn').disabled=true;
if(!betPlaced) document.getElementById('betSummary').textContent='Betting closed for this } else if(!betPlaced){ updatePlaceBtn(); }
}
function selectColor(c, el){
if(currentPhase!=='betting'||betPlaced) return;
selectedColor = c;
document.querySelectorAll('.color-btn').forEach(b=>b.classList.remove('selected'));
el.classList.add('selected');
updatePlaceBtn();
}
function selectNumber(n, el){
if(currentPhase!=='betting'||betPlaced) return;
selectedNumber = n;
document.querySelectorAll('.num-btn').forEach(b=>b.classList.remove('selected'));
el.classList.add('selected');
updatePlaceBtn();
}
function selectAmt(a, el){
selectedAmt = a;
document.querySelectorAll('.amt-chip').forEach(b=>b.classList.remove('selected'));
el.classList.add('selected');
document.getElementById('customAmt').value='';
updatePlaceBtn();
}
function selectCustomAmt(el){
selectedAmt = parseInt(el.value)||null;
document.querySelectorAll('.amt-chip').forEach(b=>b.classList.remove('selected'));
updatePlaceBtn();
}
function updatePlaceBtn(){
const ready = (selectedColor||selectedNumber!==null) && selectedAmt && selectedAmt>0 && selectedAmt<=document.getElementById('placeBtn').disabled=!ready;
if(selectedAmt && (selectedColor||selectedNumber!==null)){
const parts=[];
if(selectedColor) parts.push(selectedColor.toUpperCase());
if(selectedNumber!==null) parts.push('Number ' + selectedNumber);
document.getElementById('betSummary').textContent = 'Betting Rs.' + selectedAmt + ' on ' }
}
function placeBet(){
if(!selectedAmt||(!selectedColor&&selectedNumber===null)) return;
let betType = selectedColor&&selectedNumber!==null?'both':selectedColor?'color':'number';
send({ type:'placeBet', color:selectedColor, number:selectedNumber, betType, amount:selectedAmt }
function resetBetUI(){
document.querySelectorAll('.color-btn,.num-btn,.amt-chip').forEach(b=>b.classList.remove('selected'));
document.getElementById('customAmt').value='';
document.getElementById('betSummary').textContent='Pick color or number and amount to bet';
document.getElementById('placeBtn').disabled=true;
selectedColor=null; selectedNumber=null; selectedAmt=null;
}
function showBetResult(msg){
const card = document.getElementById('resultCard');
const c = msg.result.color;
const n = msg.result.number;
const nc = NUM_COLORS[n];
const ballClass = nc==='violet'?'mixed':nc;
const won = msg.payout>0;
card.innerHTML = '<div style="font-size:0.7rem;color:var(--muted);letter-spacing:2px;text-transform:addHistoryDot(n, c, roundNum);
}
function showRoundResult(result, rnd){
if(!betPlaced){
const c=result.color, n=result.number, nc=NUM_COLORS[n];
const ballClass=nc==='violet'?'mixed':nc;
document.getElementById('resultCard').innerHTML = '<div style="font-size:0.7rem;color:var(--addHistoryDot(n, c, rnd);
}
}
function addHistoryDot(n, c, rnd){
const dots = document.getElementById('historyDots');
if(dots.querySelector('span')) dots.innerHTML='';
const nc = NUM_COLORS[n];
const cls = nc==='violet'?'mixed':nc;
const item = document.createElement('div');
item.className='h-dot-item';
item.innerHTML='<div class="h-circle ' + cls + '">' + n + '</div><div class="h-rnd">#' + rnd dots.insertBefore(item, dots.firstChild);
if(dots.children.length>15) dots.removeChild(dots.lastChild);
}
function buildAdminNumGrid(){
const grid = document.getElementById('adminNumGrid');
grid.innerHTML='';
for(let i=0;i<=9;i++){
const btn=document.createElement('div');
btn.className='rs-num';
btn.textContent=i;
btn.onclick=()=>adminSelectNumber(i,btn);
grid.appendChild(btn);
}
}
function adminSelectColor(c, el){
adminSelColor=c;
document.querySelectorAll('.rs-btn').forEach(b=>b.classList.remove('selected'));
el.classList.add('selected');
checkAdminReady();
}
function adminSelectNumber(n, el){
adminSelNumber=n;
document.querySelectorAll('.rs-num').forEach(b=>b.classList.remove('selected'));
el.classList.add('selected');
checkAdminReady();
}
function checkAdminReady(){
const ready = adminSelColor!==null && adminSelNumber!==null;
document.getElementById('setResultBtn').disabled=!ready;
if(ready) document.getElementById('adminStatus').textContent='Ready: ' + adminSelColor + ' }
function adminSetResult(){
if(adminSelColor===null||adminSelNumber===null) return;
if(!confirm('Set result: ' + adminSelColor.toUpperCase() + ' + ' + adminSelNumber + '?')) return;
send({ type:'adminSetResult', color:adminSelColor, number:adminSelNumber });
adminSelColor=null; adminSelNumber=null;
document.querySelectorAll('.rs-btn,.rs-num').forEach(b=>b.classList.remove('selected'));
document.getElementById('setResultBtn').disabled=true;
document.getElementById('adminStatus').textContent='Result set! Calculating payouts...';
}
function updateAdminUI(data){
document.getElementById('adminRoundInfo').textContent='Round #' + data.round + ' - ' + data.document.getElementById('betCount').textContent=data.bets.length;
document.getElementById('poolAmt').textContent='Rs.' + data.totalPool.toLocaleString('en-IN');
const bl=document.getElementById('adminBetsList');
if(!data.bets.length){ bl.innerHTML='<span style="color:var(--muted);font-size:0.82rem;">No else { bl.innerHTML=data.bets.map(b=>'<div class="bet-item"><div class="bet-color-dot" style="const pb=document.getElementById('playersTableBody');
pb.innerHTML=data.players.map(p=>'<tr><td>' + p.username + '</td><td style="color:var(--gold)">const hb=document.getElementById('adminHistBody');
hb.innerHTML=data.history.map(r=>{ const profit=r.totalPool-r.totalPayout; return '<tr><td>#' }
function adminAddBal(username){
const amt=parseInt(document.getElementById('amt_'+username).value);
if(!amt||amt<=0) return alert('Enter valid amount');
send({ type:'adminAddBalance', username, amount:amt });
}
function adminRemoveBal(username){
const amt=parseInt(document.getElementById('amt_'+username).value);
if(!amt||amt<=0) return alert('Enter valid amount');
send({ type:'adminRemoveBalance', username, amount:amt });
}
setInterval(()=>{
if(currentPhase==='betting' && roundTimeLeft>0){ roundTimeLeft--; updateTimer(); }
},1000);
document.addEventListener('DOMContentLoaded', function(){
document.getElementById('loginTab').addEventListener('click', function(){ switchTab('login'); document.getElementById('registerTab').addEventListener('click', function(){ switchTab('register'); document.getElementById('authBtn').addEventListener('click', doAuth);
document.getElementById('adminLinkBtn').addEventListener('click', showAdminLogin);
});
connectWS(()=>{
document.addEventListener('keydown', e=>{
if(e.key==='Enter'){
const authScreen=document.getElementById('authScreen');
if(authScreen.classList.contains('active')){
const adminPassInp=document.getElementById('adminPassInp');
if(adminPassInp) doAdminLogin(); else doAuth();
}
}
});
});
</script>
</body>
</html>`;
app.get('*', (req, res) => {
res.setHeader('Content-Type', 'text/html');
res.send(HTML);
});
app.get('/api/history', (req, res) => res.json(rounds.slice(-50).reverse()));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('07 Winn Game running on port ' + PORT));
