// src/middleware/auth.js
// Verifies session token on protected routes

const { getDb } = require('../config/firebase');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const { uid } = JSON.parse(Buffer.from(token, 'base64').toString());

    const db  = getDb();
    const snap = await db.collection('users').doc(uid).get();

    if (!snap.exists) return res.status(401).json({ error: 'User not found' });

    const user = snap.data();

    // Check if user has access (premium or trial)
    const trialDays = Math.floor(
      (Date.now() - new Date(user.trialStart).getTime()) / (1000 * 60 * 60 * 24)
    );
    const hasAccess = user.isPremium || trialDays < 7;

    req.user = { ...user, hasAccess, trialDays };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requirePremium(req, res, next) {
  if (!req.user?.hasAccess) {
    return res.status(403).json({
      error:   'Subscription required',
      message: 'Your 7-day trial has ended. Please subscribe to continue.',
    });
  }
  next();
}

module.exports = { requireAuth, requirePremium };
