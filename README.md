# 🎮 07 Winn — Color Trading Game

## Features
- ✅ Green / Violet / Red color betting (55Club / Tiranga style)
- ✅ Number betting (0–9) with 9× payout
- ✅ 60-second live countdown timer
- ✅ Admin Panel — manually set results
- ✅ Player balance management
- ✅ Full round history with profit/loss
- ✅ Real-time multiplayer via WebSockets

## Payout System
| Bet | Payout |
|-----|--------|
| Color (Green/Red) | 2× |
| Color (Violet) | 4.5× |
| Number 0-9 | 9× |
| 0 or 5 (Violet+Red/Green) | 1.5× on color |

## Number → Color Mapping (Tiranga Style)
- 0 → Violet + Red
- 1, 3, 7, 9 → Red
- 2, 4, 6, 8 → Green
- 5 → Violet + Green

## Admin Panel
- Password: **admin123** (change in server/index.js line 13)
- Set any result manually
- Add/remove player balance
- See all bets in real time
- Full profit/loss history

---

## 🚀 Deploy on Railway (FREE)

### Step 1: Create GitHub Repo
1. Go to github.com → New Repository
2. Name it `07-winn`
3. Upload all these files

### Step 2: Deploy on Railway
1. Go to **railway.app**
2. Sign up (free)
3. Click **"New Project"** → **"Deploy from GitHub"**
4. Select your repo
5. Railway auto-detects Node.js and deploys!
6. Click **"Generate Domain"** — you get a free URL

### Step 3: Share Link
- Share the Railway URL with your players
- Admin Panel: Go to same URL → click "Admin" link → password: admin123

---

## 🔧 Local Testing
```bash
cd server
npm install
node index.js
# Open http://localhost:3000
```

## ⚠️ Important
- Change admin password in `server/index.js` line 13
- Data resets if server restarts (in-memory storage)
- For permanent storage, add MongoDB later
