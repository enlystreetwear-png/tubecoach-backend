// src/config/firebase.js
// Initializes Firebase Admin SDK (Firestore database)

const admin = require('firebase-admin');

let db = null;

function initFirebase() {
  if (admin.apps.length > 0) return admin.apps[0];

  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Railway / Vercel env vars encode \n as literal \\n — fix that here
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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
