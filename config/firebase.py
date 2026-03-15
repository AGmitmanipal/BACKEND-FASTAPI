const { Pool } = require("pg");
require("dotenv").config();

let pool;

try {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL missing in environment variables");
    }

    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === "production"
            ? { rejectUnauthorized: false }
            : false
    });

    console.log("🔥 PostgreSQL connected");

} catch (error) {
    console.error("❌ PostgreSQL Initialization Error:", error.message);
    process.exit(1);
}

module.exports = { pool };
