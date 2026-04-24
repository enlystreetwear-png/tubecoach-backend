require('dotenv').config();
const { initFirebase, getDb } = require('./src/config/firebase');
initFirebase();
const db = getDb();

async function fix() {
  await db.collection('users').doc('116002608153022243506').update({
    trialStart: new Date('2025-01-01').toISOString(),
    isPremium: false,
  });
  console.log('Done — trial expired for user 116002608153022243506');
  process.exit(0);
}
fix().catch(console.error);
