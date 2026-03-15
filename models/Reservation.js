const { db } = require('../config/firebase');

const reservationsCollection = db.collection('reservations');

module.exports = {
  collection: reservationsCollection,
  // Helper for unique constraint check
  checkActiveReservation: async (userId, zoneId) => {
    // Check "booked"
    const bookedSnap = await reservationsCollection
      .where('userId', '==', userId)
      .where('zoneId', '==', zoneId)
      .where('status', '==', 'booked')
      .get();

    if (!bookedSnap.empty) return bookedSnap.docs[0];

    // Check "reserved"
    const reservedSnap = await reservationsCollection
      .where('userId', '==', userId)
      .where('zoneId', '==', zoneId)
      .where('status', '==', 'reserved')
      .get();

    if (!reservedSnap.empty) return reservedSnap.docs[0];

    return null;
  }
};
