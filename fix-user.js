require('dotenv').config();
const { initFirebase, getDb } = require('./src/config/firebase');

initFirebase();
const db = getDb();

async function fix() {
  // Reset trialStart to today for all users so trial is fresh
  const users = await db.collection('users').get();
  for (const u of users.docs) {
    await u.ref.update({
      trialStart: new Date().toISOString(),
      isPremium: false,
    });
    console.log('Fixed user:', u.id);
  }
  console.log('Done');
  process.exit(0);
}

fix().catch(console.error);
