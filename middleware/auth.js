const { admin, db } = require('../config/firebase');

const usersRef = db.collection('users');

const requireAuth = async (req, res, next) => {
    try {
        if (!admin.apps || admin.apps.length === 0) {
            return res.status(500).json({
                message: 'Server auth is not configured (Firebase Admin not initialized).',
                code: 'AUTH_NOT_CONFIGURED'
            });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized: No token provided' });
        }

        const token = authHeader.split(' ')[1];
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(token);
        } catch (verifyError) {
            console.error('🔥 Token Verification Failed:', verifyError.code, verifyError.message);
            return res.status(401).json({ message: 'Unauthorized: Invalid token', code: verifyError.code, error: verifyError.message });
        }

        const { uid, email } = decodedToken;

        // Find or Create User in Firestore
        // Using direct doc reference by UID is faster and cleaner
        const userDocRef = usersRef.doc(uid);
        let userSnap = await userDocRef.get();
        let userData;

        if (!userSnap.exists) {
            console.log(`👤 User not found in DB, creating new user for ${uid}`);

            userData = {
                uid,
                email: email || `no-email-${uid}@placeholder.com`,
                role: 'user',
                approved: true, // Auto-approve for now
                vehiclePlate: 'PENDING',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await userDocRef.set(userData);
            console.log(`✨ New user created: ${userData.email} (${uid})`);
        } else {
            userData = userSnap.data();
        }

        // Attach helper method for backward compatibility if needed, strict separation preferred though.
        // We attach plain data + save/update method wrapper if specific logic needs it?
        // But for auth middleware, we just need `req.user` data mostly.
        // However, `routes/auth.js` calls `user.save()`.

        req.user = {
            ...userData,
            _id: uid, // Use uid as _id for compatibility
            // Helper for updates (used in routes/auth.js)
            save: async function () {
                const { save, ...dataToSave } = this;
                // Delete _id as well if it's there
                delete dataToSave._id;
                await userDocRef.set(dataToSave, { merge: true });
                return this;
            }
        };

        next();
    } catch (error) {
        console.error('🔥 Auth Middleware Error:', error);
        res.status(500).json({ message: 'Internal Server Authentication Error', error: error.message });
    }
};

const requireApprovedUser = (req, res, next) => {
    // Approval requirement removed as per user request
    next();
};

const requireAdmin = (req, res, next) => {
    // Admin restriction removed as per user request
    next();
};

module.exports = { requireAuth, requireApprovedUser, requireAdmin };
