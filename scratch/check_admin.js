const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'yoy-ia-billar'
});

const db = admin.firestore();

async function check() {
  console.log("Listing users from Firestore using firebase-admin...");
  const snap = await db.collection('users').get();
  console.log(`Found ${snap.size} users:`);
  snap.forEach(doc => {
    console.log(`- ID: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
  });
}

check().catch(console.error);
