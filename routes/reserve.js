const express = require("express");
const cron = require("node-cron");
const { db } = require("../config/firebase");

const router = express.Router();
const reservationsRef = db.collection("reservations");
const zonesRef = db.collection("parkingzones");

let cronStarted = false;

function startReservationCron() {
  if (cronStarted) return;
  cronStarted = true;

  // ================= CRON JOB =================
  // Runs every minute to expire reservations
  cron.schedule("* * * * *", async () => {
    const now = new Date();

    try {
      const batch = db.batch();
      let updateCount = 0;

      // 1. Expire "reserved"
      const reservedSnap = await reservationsRef
        .where("status", "==", "reserved")
        .where("toTime", "<", now)
        .get();

      reservedSnap.forEach(doc => {
        batch.update(doc.ref, { status: "expired" });
        updateCount++;
      });

      // 2. Expire "booked"
      const bookedSnap = await reservationsRef
        .where("status", "==", "booked")
        .where("toTime", "<", now)
        .get();

      bookedSnap.forEach(doc => {
        batch.update(doc.ref, { status: "expired" });
        updateCount++;
      });

      if (updateCount > 0) {
        console.log(`♻️ Expiring ${updateCount} reservations/bookings...`);
        await batch.commit();
      }

    } catch (err) {
      console.error("❌ Cron error:", err);
    }
  });
}

// ================= GET USER BOOKINGS =================
router.get("/reserve/book", async (req, res) => {
  const userId = req.query.userId || req.query.email;
  if (!userId) {
    return res.status(400).json({ message: "userId required" });
  }

  try {
    const snapshot = await reservationsRef
      .where("userId", "==", userId)
      .orderBy("toTime", "desc")
      .get();

    const bookings = snapshot.docs.map(doc => ({
      _id: doc.id,
      ...doc.data(),
      // Convert Timestamps to Strings/Dates for JSON
      toTime: doc.data().toTime.toDate ? doc.data().toTime.toDate() : doc.data().toTime,
      fromTime: doc.data().fromTime.toDate ? doc.data().fromTime.toDate() : doc.data().fromTime,
      parkedAt: doc.data().parkedAt && doc.data().parkedAt.toDate ? doc.data().parkedAt.toDate() : doc.data().parkedAt
    }));

    // N+1 Optimization: Batch fetch zones
    const zoneIds = [...new Set(bookings.map(b => b.zoneId))];
    if (zoneIds.length > 0) {
      // Firestore 'in' query supports up to 10 items (or 30? limit exists). 
      // Safer to fetch individually if many, or slice. 
      // For simplicity, fetch all relevant zones independently or use getAll logic if small.
      // Or mapping one by one since fetch by ID is fast.
      const zoneSnapshots = await Promise.all(zoneIds.map(id => zonesRef.doc(id).get()));
      const zoneMap = {};
      zoneSnapshots.forEach(doc => {
        if (doc.exists) zoneMap[doc.id] = doc.data().name;
      });

      bookings.forEach(b => {
        b.zoneName = zoneMap[b.zoneId] || "Unknown Zone";
      });
    }

    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load bookings" });
  }
});

// ================= CREATE PRE-BOOKING =================
router.post("/prebook", async (req, res) => {
  const { userId, zoneId, fromTime, toTime } = req.body;

  if (!userId || !zoneId || !fromTime || !toTime) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const start = new Date(fromTime);
  const end = new Date(toTime);
  const now = new Date();

  if (start >= end) {
    return res.status(400).json({ message: "Invalid time range" });
  }

  if (start.getTime() <= now.getTime()) {
    return res.status(400).json({
      message: "Pre-bookings must be for future time. Use /reserve for immediate reservations."
    });
  }

  try {
    const result = await db.runTransaction(async (t) => {
      const zoneDocRef = zonesRef.doc(zoneId);
      const zoneDoc = await t.get(zoneDocRef);

      if (!zoneDoc.exists) {
        throw { status: 404, message: "Zone not found" };
      }

      const zoneData = zoneDoc.data();

      // 1. One active action per zone
      const existingSnap = await t.get(reservationsRef
        .where("userId", "==", userId)
        .where("zoneId", "==", zoneId)
        .where("status", "in", ["booked", "reserved"])
      );

      if (!existingSnap.empty) {
        throw { status: 409, message: "You already have an active pre-booking or reservation in this zone." };
      }

      // 2. Capacity Check
      // Overlap: start < existing.end AND end > existing.start
      // Query: existing.end > start
      const potentialOverlaps = await t.get(reservationsRef
        .where("zoneId", "==", zoneId)
        .where("status", "in", ["reserved", "booked"])
        .where("toTime", ">", start)
      );

      let overlapCount = 0;
      let totalReserved = 0;
      let totalBooked = 0;

      potentialOverlaps.forEach(doc => {
        const d = doc.data();
        const dStatus = d.status;
        const dStart = d.fromTime.toDate ? d.fromTime.toDate() : new Date(d.fromTime);
        // dEnd is inherently > start because of query

        if (dStatus === 'reserved') totalReserved++;
        if (dStatus === 'booked') totalBooked++;

        if (end > dStart) { // The second part of overlap check
          overlapCount++;
        }
      });

      // Current capacity usage (global)
      const overallAvailable = Math.max(0, (zoneData.capacity || 0) - totalReserved - totalBooked);

      if (overlapCount >= (zoneData.capacity || 0)) {
        throw { status: 409, message: "Zone is fully booked for this time range." };
      }

      if (overallAvailable <= 0) {
        // Note: This check might be too strict if we are booking far in future where current reserved spots will be gone.
        // But preserving original logic. 
        // Actually, for pre-booking, only overlap matters. 
        // If the user meant "current capacity check", then it blocks new bookings if lot is full NOW, even for next year.
        // I'll keep it to match original code, but it's questionable logic.
        throw { status: 409, message: "Zone is fully booked. No available spots." };
      }

      const newDocRef = reservationsRef.doc();
      t.set(newDocRef, {
        userId,
        zoneId,
        fromTime: start,
        toTime: end,
        status: "booked",
        createdAt: new Date(),
        updatedAt: new Date()
      });

      return { id: newDocRef.id, status: "booked" };
    });

    res.json({
      message: "Pre-booking confirmed. Your reservation will activate at the scheduled time.",
      reservationId: result.id,
      status: result.status
    });

  } catch (err) {
    console.error("❌ Pre-booking Error:", err);
    const status = err.status || 500;
    const message = err.message || "Server Error";
    res.status(status).json({ message });
  }
});

// ================= MAKE RESERVATION =================
router.post("/reserve", async (req, res) => {
  const { userId, zoneId, fromTime, toTime } = req.body;

  if (!userId || !zoneId || !fromTime || !toTime) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const start = new Date(fromTime);
  const end = new Date(toTime);
  const now = new Date();

  if (start >= end) {
    return res.status(400).json({ message: "Invalid time range" });
  }

  if (start.getTime() > now.getTime()) {
    return res.status(400).json({
      message: "Reservations must start now (or earlier). For future time windows, use /prebook."
    });
  }

  try {
    const result = await db.runTransaction(async (t) => {
      const zoneDocRef = zonesRef.doc(zoneId);
      const zoneDoc = await t.get(zoneDocRef);

      if (!zoneDoc.exists) {
        throw { status: 404, message: "Zone not found" };
      }

      const zoneData = zoneDoc.data();

      // Check Existing
      const existingSnap = await t.get(reservationsRef
        .where("userId", "==", userId)
        .where("zoneId", "==", zoneId)
        .where("status", "in", ["booked", "reserved"])
      );

      let existingDoc = null;
      if (!existingSnap.empty) {
        existingDoc = existingSnap.docs[0];
      }

      if (existingDoc) {
        const existingData = existingDoc.data();
        const existingId = existingDoc.id;

        // Convert pre-booking
        if (existingData.status === "booked") {
          const exStart = existingData.fromTime.toDate ? existingData.fromTime.toDate() : new Date(existingData.fromTime);
          const exEnd = existingData.toTime.toDate ? existingData.toTime.toDate() : new Date(existingData.toTime);

          // overlaps check
          // start < exEnd && end > exStart
          const overlapsOwn = start < exEnd && end > exStart;
          const isActiveReservationWindow = start <= now && now <= end;

          if (!isActiveReservationWindow) {
            throw { status: 409, message: "Reservations are only allowed for present time (check-in now)." };
          }

          if (!overlapsOwn) {
            throw { status: 409, message: "Your reservation time must overlap your pre-booking time window." };
          }

          // Capacity Check (exclude self)
          // Overlap query excluding self ID isn't direct in Firestore queries (no 'ne').
          // We filter in memory.
          const potentialOverlaps = await t.get(reservationsRef
            .where("zoneId", "==", zoneId)
            .where("status", "in", ["reserved", "booked"])
            .where("toTime", ">", start)
          );

          let overlapCount = 0;
          potentialOverlaps.forEach(doc => {
            if (doc.id === existingId) return; // Exclude self
            const d = doc.data();
            const dStart = d.fromTime.toDate ? d.fromTime.toDate() : new Date(d.fromTime);
            if (end > dStart) overlapCount++;
          });

          if (overlapCount >= (zoneData.capacity || 0)) {
            throw { status: 409, message: "Zone is fully booked for this time range." };
          }

          // Update
          t.update(reservationsRef.doc(existingId), {
            status: "reserved",
            parkedAt: now,
            fromTime: start, // Updated times
            toTime: end,
            updatedAt: new Date()
          });

          return { message: "Pre-booking converted to active reservation.", reservationId: existingId, status: "reserved" };
        }

        if (existingData.status === "reserved") {
          throw { status: 409, message: "You already have an active reservation in this zone." };
        }
      }

      // New Reservation
      // Capacity Check
      const potentialOverlaps = await t.get(reservationsRef
        .where("zoneId", "==", zoneId)
        .where("status", "in", ["reserved", "booked"])
        .where("toTime", ">", start)
      );

      let overlapCount = 0;
      potentialOverlaps.forEach(doc => {
        const d = doc.data();
        const dStart = d.fromTime.toDate ? d.fromTime.toDate() : new Date(d.fromTime);
        if (end > dStart) overlapCount++;
      });

      if (overlapCount >= (zoneData.capacity || 0)) {
        throw { status: 409, message: "Zone is fully booked for this time range." };
      }

      const newDocRef = reservationsRef.doc();
      t.set(newDocRef, {
        userId,
        zoneId,
        fromTime: start,
        toTime: end,
        status: "reserved",
        parkedAt: now,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      return {
        message: "Reservation confirmed. Parking is active and counted as reserved.",
        reservationId: newDocRef.id,
        status: "reserved"
      };
    });

    res.json(result);

  } catch (err) {
    console.error("❌ Reservation Error:", err);
    const status = err.status || 500;
    const message = err.message || "Server Error";
    res.status(status).json({ message });
  }
});

// ================= CANCEL RESERVATION =================
router.delete("/reserve/:id", async (req, res) => {
  try {
    await db.runTransaction(async (t) => {
      const docRef = reservationsRef.doc(req.params.id);
      const doc = await t.get(docRef);

      if (!doc.exists) {
        throw { status: 404, message: "Reservation not found" };
      }

      const data = doc.data();
      if (!["booked", "reserved"].includes(data.status)) {
        throw { status: 400, message: `Cannot cancel reservation with status: ${data.status}` };
      }

      t.update(docRef, {
        status: "cancelled",
        updatedAt: new Date()
      });
    });

    res.json({ message: "Cancelled successfully", reservationId: req.params.id });

  } catch (err) {
    console.error("❌ Cancel Error:", err);
    const status = err.status || 500;
    const message = err.message || "Cancel failed";
    res.status(status).json({ message });
  }
});

module.exports = { reserveRouter: router, startReservationCron };
