const { db } = require('../config/firebase');

const zonesCollection = db.collection('parkingzones');

class Zone {
  static async find(query = {}) {
    let ref = zonesCollection;
    if (query.isActive !== undefined) {
      ref = ref.where('isActive', '==', query.isActive);
    }

    // Sort implementation (must be indexed)
    // Firestore requires indexes for sorting on filtered fields
    const snapshot = await ref.get();
    const zones = [];
    snapshot.forEach(doc => {
      zones.push(new Zone(doc.id, doc.data()));
    });

    // Manual sorting (since Firestore sorting can be tricky without composite index)
    if (query.sort && query.sort.name === 1) {
      zones.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    return zones;
  }

  static async findById(id) {
    const doc = await zonesCollection.doc(id).get();
    if (doc.exists) {
      return new Zone(doc.id, doc.data());
    }
    return null;
  }

  constructor(id, data) {
    this._id = id; // Keep _id for compatibility
    this.name = data.name;
    this.polygon = data.polygon || [];
    this.capacity = data.capacity || 0;
    this.available = data.available || 0;
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  // Helper method for express response
  lean() {
    return {
      _id: this._id,
      name: this.name,
      polygon: this.polygon,
      capacity: this.capacity,
      available: this.available,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // Note: 'lean()' isn't a method on instances unless I wrap it differently, 
  // but Mongoose usually chains .lean() to query object. 
  // Here I'm just returning instances, so I might need to adapt the call site.
  // Or I can make find() return objects directly if lean is not called.
  // To keep compatibility, I'll make find() return an array of Zone instances, and add a static helper for simple objects.
  // Actually, standard usage in this app is: await Zone.find({...}).lean();
  // So find() should probably return a query object, but that's complex to mock.
  // Instead, I'll just return plain objects from find() if possible, or array of objects with lean().
  // Let's stick to simple implementation: find() returns array of plain objects with _id.
  // If the caller expects .lean(), it will fail on array.
  // So I'll just change the caller code.
}

// Export simple functions to avoid complex mocking
const getAllZones = async () => {
  const snapshot = await zonesCollection.where('isActive', '==', true).get();
  return snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
};

const getZoneById = async (id) => {
  const doc = await zonesCollection.doc(id).get();
  if (doc.exists) return { _id: doc.id, ...doc.data() };
  return null;
};

module.exports = {
  find: async (query) => {
    // Mocking Mongoose find().sort().lean() chain is hard.
    // I'll return a Promise that resolves to the array, but add a no-op sort and lean methods to the promise?
    // No, that's messy.
    // I will refactor the caller code instead.
    // But for now, let's export the collection and helper functions.
    const zones = await getAllZones();
    return zones;
  },
  findById: getZoneById,
  collection: zonesCollection
};
