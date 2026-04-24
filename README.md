# TubeCoach Backend — Setup Guide

Complete Node.js backend for the TubeCoach YouTube AI Growth Assistant.

---

## File Structure

```
tubecoach-backend/
├── server.js                    ← Entry point (run this)
├── .env.example                 ← Copy this to .env and fill in keys
├── src/
│   ├── config/
│   │   └── firebase.js          ← Firebase Admin SDK setup
│   ├── middleware/
│   │   └── auth.js              ← Token verification, premium check
│   ├── routes/
│   │   ├── auth.js              ← Google OAuth + YouTube channel detect
│   │   ├── dashboard.js         ← Plan, Analysis, Chat, Goal endpoints
│   │   └── payment.js           ← Razorpay ₹499/month subscription
│   ├── services/
│   │   ├── claude.js            ← All Claude API calls (plan, chat, analysis)
│   │   └── youtube.js           ← YouTube Data API v3 calls
│   └── cron/
│       └── weeklyJob.js         ← Auto-runs every Monday 6 AM IST
```

---

## Step 1 — Google Cloud Setup (YouTube API + OAuth)

1. Go to https://console.cloud.google.com
2. Create a new project (e.g. "TubeCoach")
3. Go to **APIs & Services → Enable APIs**
4. Enable these two APIs:
   - **YouTube Data API v3**
   - **Google+ API** (for profile info)
5. Go to **APIs & Services → Credentials**
6. Click **Create Credentials → OAuth 2.0 Client ID**
7. Application type: **Web application**
8. Add Authorized redirect URI:
   - Development: `http://localhost:4000/auth/google/callback`
   - Production: `https://your-backend.railway.app/auth/google/callback`
9. Copy **Client ID** and **Client Secret** → paste into `.env`

---

## Step 2 — Firebase Setup (Firestore Database)

1. Go to https://console.firebase.google.com
2. Create a new project (e.g. "tubecoach")
3. Go to **Firestore Database → Create database**
   - Choose **Production mode**
   - Region: **asia-south1** (Mumbai — closest to India)
4. Go to **Project Settings → Service Accounts**
5. Click **Generate new private key** → download the JSON file
6. Copy these values into your `.env`:
   - `FIREBASE_PROJECT_ID` = `projectId` from the JSON
   - `FIREBASE_CLIENT_EMAIL` = `client_email` from the JSON
   - `FIREBASE_PRIVATE_KEY` = `private_key` from the JSON

**Firestore Security Rules** (paste in Firestore → Rules tab):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    match /payments/{doc} {
      allow read: if request.auth != null;
      allow write: if false; // only backend writes
    }
  }
}
```

---

## Step 3 — Razorpay Setup

1. Go to https://dashboard.razorpay.com
2. Create an account (use your Indian phone number)
3. Go to **Settings → API Keys**
4. Generate a key pair
5. Copy **Key ID** and **Key Secret** → paste into `.env`

> For testing, use Razorpay test mode keys (start with `rzp_test_`)
> Use card: 4111 1111 1111 1111 | Any future date | Any CVV

---

## Step 4 — Create Your .env File

```bash
cp .env.example .env
```

Then open `.env` and fill in all values:

```env
ANTHROPIC_API_KEY=sk-ant-your-key-here
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your_secret
PORT=4000
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=any-long-random-string-here
NODE_ENV=development
```

---

## Step 5 — Run Locally

```bash
npm install
npm run dev
```

You should see:
```
✅ Firebase connected
⏰ Weekly cron scheduled — Mondays 6:00 AM IST
🚀 TubeCoach API running on http://localhost:4000
```

Test the health check:
```bash
curl http://localhost:4000/health
```

---

## Step 6 — Connect Frontend

In your frontend (`tubecoach-app.html` or React app), update the API base URL:

```js
const API = 'http://localhost:4000'; // development
// const API = 'https://your-app.railway.app'; // production
```

**Login flow:**
```
1. User clicks "Continue with Google"
2. Frontend redirects to: GET /auth/google
3. User logs in with Google
4. Backend redirects to: FRONTEND_URL/auth-success?token=xxx&hasChannel=true
5. Frontend saves token to localStorage
6. Frontend calls POST /auth/verify with token to get full user data
7. If onboarded=false → show onboarding screen
8. If onboarded=true → show dashboard
```

**All API calls need this header:**
```js
headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
```

---

## Step 7 — Deploy to Railway (Backend)

1. Push code to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Select your repo
4. Add all environment variables from `.env` in Railway's Variables tab
5. Change `GOOGLE_REDIRECT_URI` to your Railway URL:
   `https://your-app.railway.app/auth/google/callback`
6. Change `FRONTEND_URL` to your Vercel frontend URL
7. Deploy!

---

## API Endpoints Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | None | Health check |
| GET | `/auth/google` | None | Start Google OAuth |
| GET | `/auth/google/callback` | None | OAuth callback |
| POST | `/auth/verify` | None | Verify session token |
| POST | `/auth/logout` | None | Logout |
| POST | `/dashboard/onboard` | ✓ | Save niche/goals |
| GET | `/dashboard/me` | ✓ | Get user profile |
| GET | `/dashboard/plan` | ✓ Premium | Get weekly action plan |
| PATCH | `/dashboard/plan/task` | ✓ Premium | Toggle task done/undone |
| GET | `/dashboard/analysis` | ✓ Premium | Weekly stats + AI insight |
| POST | `/dashboard/chat` | ✓ Premium | AI coach chat |
| GET | `/dashboard/goal` | ✓ Premium | Goal tracker + roadmap |
| POST | `/payment/create-order` | ✓ | Create Razorpay order |
| POST | `/payment/verify` | ✓ | Verify payment + activate |
| GET | `/payment/status` | ✓ | Check subscription status |
| POST | `/payment/cancel` | ✓ | Cancel subscription |

---

## Manual Weekly Job Trigger (for testing)

```bash
npm run trigger-weekly
```

This runs the Monday job immediately — useful for testing without waiting.

---

## Costs Estimate (monthly, for 100 users)

| Service | Cost |
|---------|------|
| Railway backend | ~$5 (free tier) |
| Firebase Firestore | Free (under limits) |
| YouTube Data API | Free (10,000 units/day) |
| Claude API | ~₹2,000-3,000 (depends on usage) |
| Razorpay | 2% per transaction |
| **Revenue at 100 users** | **₹49,900/month** |

---

## Need Help?

- Google OAuth issues → https://console.cloud.google.com/apis/credentials
- Firebase issues → https://console.firebase.google.com
- Razorpay issues → https://dashboard.razorpay.com
- Claude API → https://console.anthropic.com
# force redeploy Fri Apr 24 17:08:13 IST 2026
