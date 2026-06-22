const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

let serviceAccount = null;
const localKeyPath = path.join(__dirname, '..', 'serviceAccountKey.json');

if (fs.existsSync(localKeyPath)) {
  serviceAccount = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
}

if (!serviceAccount) {
  console.log("No serviceAccountKey.json found locally. Please download it or run the query via API.");
  process.exit(1);
}

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function run() {
  try {
    const snap = await db.collection('users').get();
    console.log(`Found ${snap.size} users:`);
    snap.forEach(doc => {
      console.log(doc.id, "=>", JSON.stringify(doc.data(), null, 2));
    });
  } catch (e) {
    console.error("Error fetching users:", e);
  }
}
run();
