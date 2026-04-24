// src/routes/auth.js
// Handles Google OAuth login and YouTube channel detection

const express  = require('express');
const axios    = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { getDb } = require('../config/firebase');

const router = express.Router();

// ── OAuth client ──────────────────────────────────────────────────────────────
function getOAuthClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/google
// Redirects user to Google's consent screen
// ─────────────────────────────────────────────────────────────────────────────
router.get('/google', (req, res) => {
  const isApp = req.query.state === 'app' || req.query.redirect === 'app';
  const client = getOAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state: isApp ? 'app' : 'web',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ],
  });
  res.redirect(url);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/google/callback
// Google redirects here after user grants permission
// ─────────────────────────────────────────────────────────────────────────────
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`${process.env.FRONTEND_URL}?error=access_denied`);
  }

  try {
    const client = getOAuthClient();

    // 1. Exchange code for tokens
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // 2. Get user profile from Google
    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = profileRes.data;

    // 3. Check if user has a YouTube channel
    const channelData = await fetchYouTubeChannel(tokens.access_token);

    // 4. Upsert user in Firestore
    const db = getDb();
    const userRef = db.collection('users').doc(profile.id);
    const userSnap = await userRef.get();

    const userData = {
      uid:          profile.id,
      email:        profile.email,
      name:         profile.name,
      avatar:       profile.picture ? profile.picture.replace('s96-c','s400-c') : null,
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token || userSnap.data()?.refreshToken,
      hasChannel:   !!channelData,
      channel:      channelData || null,
      updatedAt:    new Date().toISOString(),
    };

    if (!userSnap.exists) {
      userData.createdAt   = new Date().toISOString();
      userData.isPremium   = false;
      userData.trialStart  = new Date().toISOString();
      userData.onboarded   = false;
    }

    await userRef.set(userData, { merge: true });

    // 5. Return a simple session token (uid encoded — use JWT in production)
    const sessionToken = Buffer.from(JSON.stringify({ uid: profile.id })).toString('base64');

    // 6. Redirect frontend with session token + channel status
    const params = new URLSearchParams({
      token:      sessionToken,
      hasChannel: !!channelData,
      name:       profile.name,
      email:      profile.email,
    });
    // Check if this came from the mobile app
    // Use OAuth state param to detect app vs web login
    const isApp = req.query.state === 'app';
    if (isApp) {
      res.redirect(`tubecoach://callback?${params}`);
    } else {
      res.redirect(`${process.env.FRONTEND_URL}?${params}`);
    }

  } catch (err) {
    console.error('Auth callback error:', err.message);
    const errMsg = encodeURIComponent(err.message.substring(0, 100));
    res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed&detail=${errMsg}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/verify
// Frontend sends token → backend verifies and returns full user data
// ─────────────────────────────────────────────────────────────────────────────
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(401).json({ error: 'No token' });

    const { uid } = JSON.parse(Buffer.from(token, 'base64').toString());
    const db = getDb();
    const snap = await db.collection('users').doc(uid).get();

    if (!snap.exists) return res.status(404).json({ error: 'User not found' });

    const user = snap.data();
    // Check trial status
    const trialDays = Math.floor(
      (Date.now() - new Date(user.trialStart).getTime()) / (1000 * 60 * 60 * 24)
    );
    const trialActive = trialDays < 30;

    res.json({
      uid:        user.uid,
      name:       user.name,
      email:      user.email,
      avatar:     user.avatar,
      hasChannel: user.hasChannel,
      channel:    user.channel,
      isPremium:  user.isPremium || trialActive,
      trialActive,
      trialDaysLeft: Math.max(0, 30 - trialDays),
      onboarded:  user.onboarded,
      profile:    user.profile || null,
    });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/logout  (just clears server-side if needed)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: fetch YouTube channel for authenticated user
// ─────────────────────────────────────────────────────────────────────────────
async function fetchYouTubeChannel(accessToken) {
  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'snippet,statistics,brandingSettings',
        mine: true,
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const items = res.data.items;
    if (!items || items.length === 0) return null;

    const ch = items[0];
    return {
      id:           ch.id,
      title:        ch.snippet.title,
      description:  ch.snippet.description,
      country:      ch.snippet.country,
      thumbnail:    ch.snippet.thumbnails?.default?.url,
      subscribers:  parseInt(ch.statistics.subscriberCount || 0),
      totalViews:   parseInt(ch.statistics.viewCount || 0),
      videoCount:   parseInt(ch.statistics.videoCount || 0),
      createdAt:    ch.snippet.publishedAt,
    };
  } catch (err) {
    console.error('YouTube channel fetch error:', err.response?.data || err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/avatar?url=...
// Proxies Google profile picture to avoid CORS issues
// ─────────────────────────────────────────────────────────────────────────────
router.get('/avatar', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !url.startsWith('https://')) {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(response.data);
  } catch (err) {
    res.status(404).send('');
  }
});

module.exports = router;
