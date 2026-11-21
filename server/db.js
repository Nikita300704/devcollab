const { Pool } = require("pg");

// a pool keeps a few connections open and reuses them
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// an idle connection can be dropped by the host: log it instead of crashing
pool.on("error", (err) => {
  console.error("Database pool error:", err.message);
});

module.exports = { pool };