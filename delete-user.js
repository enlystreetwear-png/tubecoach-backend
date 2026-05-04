require('dotenv').config();
const { initFirebase, getDb } = require('./src/config/firebase');
initFirebase();
const db = getDb();

async function deleteUser() {
  const uid = '116002608153022243506';
  
  // Delete all subcollections
  const collections = ['plans', 'taskGuides', 'goalCache', 'chats'];
  for (const col of collections) {
    const snap = await db.collection('users').doc(uid).collection(col).get();
    for (const doc of snap.docs) {
      await doc.ref.delete();
      console.log('Deleted:', col, doc.id);
    }
  }
  
  // Delete user document
  await db.collection('users').doc(uid).delete();
  console.log('User deleted successfully!');
  process.exit(0);
}

deleteUser().catch(console.error);
