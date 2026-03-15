const { db } = require('../config/firebase');

const usersCollection = db.collection('users');

class User {
    static async findOne(query) {
        if (query.uid) {
            const doc = await usersCollection.doc(query.uid).get();
            if (doc.exists) {
                return new User(doc.id, doc.data());
            }
            return null;
        }
        // Fallback for other queries (not optimal for Firestore without indexes)
        let ref = usersCollection;
        for (const key in query) {
            ref = ref.where(key, '==', query[key]);
        }
        const snapshot = await ref.limit(1).get();
        if (snapshot.empty) return null;
        return new User(snapshot.docs[0].id, snapshot.docs[0].data());
    }

    static async findById(id) {
        const doc = await usersCollection.doc(id).get();
        if (doc.exists) {
            return new User(doc.id, doc.data());
        }
        return null;
    }

    static async create(data) {
        const { uid, ...rest } = data;
        const userData = {
            uid,
            ...rest,
            createdAt: new Date().toISOString(),
            role: data.role || 'user',
            approved: data.approved !== undefined ? data.approved : true
        };

        await usersCollection.doc(uid).set(userData);
        return new User(uid, userData);
    }

    constructor(id, data) {
        this.id = id;
        this.uid = data.uid;
        Object.assign(this, data);
    }

    async save() {
        const { id, ...data } = this;
        await usersCollection.doc(this.id).set(data, { merge: true });
        return this;
    }
}

module.exports = User;
