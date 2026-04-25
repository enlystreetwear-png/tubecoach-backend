require('dotenv').config();
const { initFirebase, getDb } = require('./src/config/firebase');
initFirebase();
const db = getDb();

async function reset() {
  await db.collection('users').doc('116002608153022243506').update({
    trialStart:   new Date().toISOString(),
    isPremium:    false,
    paymentCount: 0,
    cancelScheduled: false,
  });
  console.log('Done — user reset to fresh trial');
  process.exit(0);
}
reset().catch(console.error);
