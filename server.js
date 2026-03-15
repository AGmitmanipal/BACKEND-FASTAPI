const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { db } = require("./config/firebase");

const Zone = require("./models/Zone");
const bookingRouter = require("./routes/book");
const { reserveRouter, startReservationCron } = require("./routes/reserve");
const Reservation = require("./models/Reservation");

// Auth Imports
const { requireAuth, requireApprovedUser } = require("./middleware/auth");
const authRouter = require("./routes/auth");
const adminRouter = require("./routes/admin");

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`📨 [${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health Check (Public)
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    database: "firestore"
  });
});

// Initialize Server
const initServer = async () => {
  try {
    console.log("🔥 Firestore initialized");

    // Start cron jobs
    startReservationCron();
    console.log("📅 Reservation expiry cron started");
  } catch (err) {
    console.error("❌ Cleanup/Init error:", err);
  }
};

initServer();

// --- ROUTES ---

// 1. Auth & Admin Routes (Protected by their own internal checks)
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

// 2. Business Logic Routes (Protected + Require Approval)

// Mount booking router
app.use("/api/book", requireAuth, requireApprovedUser, bookingRouter);

// GET ZONES (Protected)
app.get("/", requireAuth, requireApprovedUser, async (req, res) => {
  try {
    // 1. Fetch Zones
    const zonesSnap = await Zone.collection.where("isActive", "==", true).get();
    let zones = zonesSnap.docs.map(doc => ({ _id: doc.id, ...doc.data() }));

    // Sort by name
    zones.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // 2. Fetch Active Reservation Counts (Manual Aggregation)
    // Fetch all active reservations (status in ["booked", "reserved"])
    // Note: If scale is large, this needs optimizations (counters or specific queries per zone)
    const reservationsSnap = await Reservation.collection
      .where("status", "in", ["booked", "reserved"])
      .get();

    const statsMap = {};
    reservationsSnap.forEach(doc => {
      const data = doc.data();
      const zoneId = data.zoneId; // assuming zoneId is stored as string in Firestore
      const status = data.status;

      if (!statsMap[zoneId]) {
        statsMap[zoneId] = { reserved: 0, booked: 0 };
      }
      if (status === "reserved") statsMap[zoneId].reserved++;
      if (status === "booked") statsMap[zoneId].booked++;
    });

    const response = zones.map((zone) => {
      const zoneId = zone._id;
      const stats = statsMap[zoneId] || { reserved: 0, booked: 0 };

      // ================= PRODUCTION AUDIT: STRICT STATE SEPARATION =================

      // Count by status
      const reservedCount = stats.reserved;
      const bookedCount = stats.booked;

      // Calculate availability
      const available = Math.max(0, Math.min(zone.capacity || 0, (zone.capacity || 0) - reservedCount - bookedCount));

      return {
        _id: zone._id,
        name: zone.name || "Unnamed Zone",
        polygon: zone.polygon || [],

        // Return explicit counts
        capacity: zone.capacity || 0,
        available: available,

        // Computed stats
        reserved: reservedCount,
        prebooked: bookedCount,
      };
    });

    res.json(response);
  } catch (err) {
    console.error("❌ GET / ERROR:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Mount reserve router (Protected)
app.use("/", requireAuth, requireApprovedUser, reserveRouter);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Backend server listening on http://localhost:${PORT}`);
});
