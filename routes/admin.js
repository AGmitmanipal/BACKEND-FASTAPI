const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const usersRef = db.collection('users');

// Protect all routes
router.use(requireAuth);
router.use(requireAdmin);

// GET /pending-users
router.get('/pending-users', async (req, res) => {
    try {
        // Query: approved != true AND role != 'admin'
        // Firestore: approved == false (assuming active users are approved=true)
        // If approved field is missing or different, logic may vary. 
        // Assuming default is true for some, false for others.

        // Actually, let's just fetch all non-approved users.
        const snapshot = await usersRef
            .where('approved', '==', false)
            .get();

        let users = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));

        // Filter out admins if any ended up there ( unlikely if pending)
        users = users.filter(u => u.role !== 'admin');

        // Sort in memory
        users.sort((a, b) => {
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateB - dateA;
        });

        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /approve-user/:uid
router.patch('/approve-user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const userRef = usersRef.doc(uid);
        const doc = await userRef.get();

        if (!doc.exists) return res.status(404).json({ message: 'User not found' });

        const updates = { approved: true, role: 'user', updatedAt: new Date().toISOString() };
        await userRef.update(updates);

        res.json({ uid, ...doc.data(), ...updates });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /reject-user/:uid
// Since there is no 'rejected' role, we will delete the user record.
router.patch('/reject-user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const userRef = usersRef.doc(uid);
        const doc = await userRef.get();

        if (!doc.exists) return res.status(404).json({ message: 'User not found' });

        await userRef.delete();
        res.json({ message: 'User rejected and removed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
