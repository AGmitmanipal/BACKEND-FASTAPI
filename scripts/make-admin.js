const { db } = require('../config/firebase');

const makeAdmin = async (email) => {
    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();

        if (snapshot.empty) {
            console.log(`⚠️ User with email ${email} not found.`);
            console.log("Make sure you have signed up in the User App first!");
            process.exit(1);
        }

        const batch = db.batch();
        let updateCount = 0;

        snapshot.forEach(doc => {
            batch.update(doc.ref, { role: 'admin', approved: true });
            updateCount++;
        });

        await batch.commit();

        console.log(`🎉 Success! Updated ${updateCount} user(s) with email ${email} to ADMIN.`);
    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        process.exit();
    }
};

const email = process.argv[2];
if (!email) {
    console.log("Usage: node make-admin.js <email>");
    process.exit(1);
}

makeAdmin(email);
