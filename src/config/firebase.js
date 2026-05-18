// src/config/firebase.js
// Initializes Firebase Admin SDK (Firestore database)

const admin = require('firebase-admin');

let db = null;

function normalizePrivateKey(key) {
  return (key || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n');
}

function initFirebase() {
  if (admin.apps.length > 0) return admin.apps[0];

  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });

  db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  console.log('✅ Firebase connected');
  return app;
}

function getDb() {
  if (!db) initFirebase();
  return db;
}

module.exports = { initFirebase, getDb };
