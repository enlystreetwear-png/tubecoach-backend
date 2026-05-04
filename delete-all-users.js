require('dotenv').config();
const { initFirebase, getDb } = require('./src/config/firebase');
initFirebase();
const db = getDb();

async function deleteAll() {
  const users = await db.collection('users').get();
  for (const u of users.docs) {
    // Delete all subcollections
    const collections = ['plans', 'taskGuides', 'goalCache', 'chats'];
    for (const col of collections) {
      const snap = await db.collection('users').doc(u.id).collection(col).get();
      for (const doc of snap.docs) {
        await doc.ref.delete();
      }
    }
    // Delete user document
    await u.ref.delete();
    console.log('Deleted user:', u.id);
  }
  console.log('All users deleted!');
  process.exit(0);
}

deleteAll().catch(console.error);
