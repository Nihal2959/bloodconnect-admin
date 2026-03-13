const express = require("express");
const cors    = require("cors");
const mysql   = require("mysql2/promise");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ── DATABASE CONNECTION ──────────────────────────────────────────────
// In Pterodactyl Docker, set MYSQL_HOST in Startup tab env variables.
// The Pterodactyl panel shows "localhost:3306" but inside Docker the
// actual host is different. Add MYSQL_HOST env var in Startup tab.
const pool = mysql.createPool({
  host:               "172.18.0.1",
  port:               3306,
  database:           "s27_Bloodconnect",
  user:               "u27_GbWFsUDprz",
  password:           ".iyTgjRC.r0D6!aR34oR7o4@",
  waitForConnections: true,
  connectionLimit:    10
});

console.log("Connecting to MariaDB at 172.18.0.1:3306...");

// ── AUTO MIGRATION — creates all tables on startup ───────────────────
async function migrate() {
  const conn = await pool.getConnection();
  console.log("✅ MySQL connected");

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(100),
      blood_type VARCHAR(5),
      phone      VARCHAR(20) UNIQUE,
      city       VARCHAR(80),
      age        VARCHAR(5),
      gender     VARCHAR(20),
      weight     VARCHAR(10),
      pfp_url    TEXT,
      donations  INT DEFAULT 0,
      joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS donors (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      name         VARCHAR(100) NOT NULL,
      blood_type   VARCHAR(5)   NOT NULL,
      phone        VARCHAR(20),
      city         VARCHAR(80),
      donations    INT         DEFAULT 0,
      last_donated VARCHAR(30) DEFAULT 'Never',
      available    TINYINT(1)  DEFAULT 1,
      created_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS sos_requests (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      patient    VARCHAR(100),
      blood_type VARCHAR(5),
      hospital   VARCHAR(150),
      units      INT         DEFAULT 1,
      urgency    VARCHAR(20) DEFAULT 'normal',
      status     VARCHAR(20) DEFAULT 'open',
      posted_by  VARCHAR(100) DEFAULT 'Anonymous',
      posted_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS camps (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      name         VARCHAR(150),
      date         VARCHAR(30),
      location     VARCHAR(200),
      total_slots  INT DEFAULT 50,
      booked_slots INT DEFAULT 0,
      time         VARCHAR(50)
    )
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS camp_bookings (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      camp_id    INT,
      user_name  VARCHAR(100),
      blood_type VARCHAR(5),
      phone      VARCHAR(20),
      slot       VARCHAR(30),
      ticket_id  VARCHAR(30),
      booked_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS donations (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_phone VARCHAR(20),
      date       VARCHAR(30),
      notes      TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS consults (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      type       VARCHAR(50),
      name       VARCHAR(100),
      phone      VARCHAR(20),
      date       VARCHAR(30),
      note       TEXT,
      status     VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed camps only if table is empty
  const [existing] = await conn.execute("SELECT COUNT(*) AS c FROM camps");
  if (existing[0].c === 0) {
    await conn.execute(`
      INSERT INTO camps (name, date, location, total_slots, booked_slots, time) VALUES
      ('Pimpri Blood Drive',  '2026-04-10', 'Pimpri Community Hall, Pimpri',    60, 0, '9AM – 1PM'),
      ('Chinchwad Camp',      '2026-04-18', 'Chinchwad Gaon Ground, Chinchwad', 40, 0, '10AM – 2PM'),
      ('Pune Central Drive',  '2026-05-02', 'Shivajinagar, Pune',               80, 0, '8AM – 12PM')
    `);
    console.log("🌱 Seeded starter camps");
  }

  conn.release();
  console.log("✅ All tables ready");

  // Start server only after DB is ready
  const PORT = process.env.PORT || 36549;
  app.listen(PORT, () => console.log("🩸 BloodConnect API running on port " + PORT));
}

migrate().catch(err => {
  console.error("❌ Startup failed:", err.message);
  console.error("Full error:", err);
  process.exit(1);
});

// ── HEALTH CHECK ─────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "BloodConnect API running" }));

// ═══════════════════════════════════════════════════════════════════════
// DONORS
// ═══════════════════════════════════════════════════════════════════════

app.get("/donors", async (req, res) => {
  try {
    const { blood } = req.query;
    let sql = "SELECT * FROM donors ORDER BY created_at DESC";
    let params = [];
    if (blood) {
      sql = "SELECT * FROM donors WHERE blood_type = ? ORDER BY created_at DESC";
      params = [blood];
    }
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("GET /donors:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/donor", async (req, res) => {
  try {
    const { name, blood_type, phone, city } = req.body;
    if (!name || !blood_type || !phone || !city)
      return res.status(400).json({ error: "All fields required" });
    const [result] = await pool.execute(
      "INSERT INTO donors (name, blood_type, phone, city) VALUES (?,?,?,?)",
      [name, blood_type, phone, city]
    );
    const [rows] = await pool.execute("SELECT * FROM donors WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /donor:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PROFILE / USERS
// ═══════════════════════════════════════════════════════════════════════

app.get("/user/:phone", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM users WHERE phone = ? LIMIT 1",
      [req.params.phone]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /user:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/user", async (req, res) => {
  try {
    const { name, blood_type, phone, city, age, gender, weight, pfp_url } = req.body;
    await pool.execute(
      `INSERT INTO users (name, blood_type, phone, city, age, gender, weight, pfp_url)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         name=VALUES(name), blood_type=VALUES(blood_type), city=VALUES(city),
         age=VALUES(age), gender=VALUES(gender), weight=VALUES(weight), pfp_url=VALUES(pfp_url)`,
      [name, blood_type, phone, city, age||"", gender||"", weight||"", pfp_url||""]
    );
    const [rows] = await pool.execute("SELECT * FROM users WHERE phone = ?", [phone]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /user:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/user/:phone", async (req, res) => {
  try {
    const { name, blood_type, city, age, gender, weight, pfp_url } = req.body;
    await pool.execute(
      "UPDATE users SET name=?, blood_type=?, city=?, age=?, gender=?, weight=?, pfp_url=? WHERE phone=?",
      [name, blood_type, city, age||"", gender||"", weight||"", pfp_url||"", req.params.phone]
    );
    const [rows] = await pool.execute("SELECT * FROM users WHERE phone = ?", [req.params.phone]);
    res.json(rows[0]);
  } catch (err) {
    console.error("PATCH /user:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// SOS / EMERGENCY
// ═══════════════════════════════════════════════════════════════════════

app.get("/sos", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM sos_requests ORDER BY posted_at DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /sos:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/sos", async (req, res) => {
  try {
    const { patient, blood_type, hospital, units, urgency, posted_by } = req.body;
    const [result] = await pool.execute(
      "INSERT INTO sos_requests (patient, blood_type, hospital, units, urgency, posted_by) VALUES (?,?,?,?,?,?)",
      [patient, blood_type, hospital, units||1, urgency||"normal", posted_by||"Anonymous"]
    );
    const [rows] = await pool.execute("SELECT * FROM sos_requests WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /sos:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/sos/:id", async (req, res) => {
  try {
    const { status } = req.body;
    await pool.execute(
      "UPDATE sos_requests SET status=? WHERE id=?",
      [status||"responding", req.params.id]
    );
    const [rows] = await pool.execute("SELECT * FROM sos_requests WHERE id = ?", [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error("PATCH /sos:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// CAMPS
// ═══════════════════════════════════════════════════════════════════════

app.get("/camps", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM camps ORDER BY date ASC");
    res.json(rows);
  } catch (err) {
    console.error("GET /camps:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/camp-booking", async (req, res) => {
  try {
    const { camp_id, user_name, blood_type, phone, slot } = req.body;
    const ticket_id = "BC" + Date.now().toString().slice(-6);
    const [result] = await pool.execute(
      "INSERT INTO camp_bookings (camp_id, user_name, blood_type, phone, slot, ticket_id) VALUES (?,?,?,?,?,?)",
      [camp_id, user_name, blood_type, phone, slot, ticket_id]
    );
    await pool.execute(
      "UPDATE camps SET booked_slots = booked_slots + 1 WHERE id = ?",
      [camp_id]
    );
    const [rows] = await pool.execute("SELECT * FROM camp_bookings WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /camp-booking:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/camp-bookings/:phone", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT cb.*, c.name AS camp_name, c.date, c.location
       FROM camp_bookings cb
       JOIN camps c ON cb.camp_id = c.id
       WHERE cb.phone = ?
       ORDER BY cb.booked_at DESC`,
      [req.params.phone]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /camp-bookings:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// DONATION HISTORY
// ═══════════════════════════════════════════════════════════════════════

app.get("/donations/:phone", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM donations WHERE user_phone = ? ORDER BY date DESC",
      [req.params.phone]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /donations:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/donation", async (req, res) => {
  try {
    const { user_phone, date, notes } = req.body;
    const [result] = await pool.execute(
      "INSERT INTO donations (user_phone, date, notes) VALUES (?,?,?)",
      [user_phone, date, notes||""]
    );
    await pool.execute(
      "UPDATE users SET donations = donations + 1 WHERE phone = ?",
      [user_phone]
    );
    const [rows] = await pool.execute("SELECT * FROM donations WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /donation:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/donation/:id", async (req, res) => {
  try {
    await pool.execute("DELETE FROM donations WHERE id = ?", [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /donation:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// CONSULTS
// ═══════════════════════════════════════════════════════════════════════

app.post("/consult", async (req, res) => {
  try {
    const { type, name, phone, date, note } = req.body;
    const [result] = await pool.execute(
      "INSERT INTO consults (type, name, phone, date, note) VALUES (?,?,?,?,?)",
      [type, name, phone, date, note||""]
    );
    const [rows] = await pool.execute("SELECT * FROM consults WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /consult:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/consults/:phone", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM consults WHERE phone = ? ORDER BY created_at DESC",
      [req.params.phone]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /consults:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════

app.get("/admin/stats", async (req, res) => {
  try {
    const [[{ donors }]]    = await pool.execute("SELECT COUNT(*) AS donors FROM donors");
    const [[{ users }]]     = await pool.execute("SELECT COUNT(*) AS users FROM users");
    const [[{ open_sos }]]  = await pool.execute("SELECT COUNT(*) AS open_sos FROM sos_requests WHERE status='open'");
    const [[{ donations }]] = await pool.execute("SELECT COUNT(*) AS donations FROM donations");
    const [[{ camps }]]     = await pool.execute("SELECT COUNT(*) AS camps FROM camps");
    const [[{ bookings }]]  = await pool.execute("SELECT COUNT(*) AS bookings FROM camp_bookings");
    res.json({
      total_donors:    donors,
      total_users:     users,
      open_sos:        open_sos,
      total_donations: donations,
      total_camps:     camps,
      total_bookings:  bookings,
      lives_saved:     donations * 3
    });
  } catch (err) {
    console.error("GET /admin/stats:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/users",    async (req, res) => { try { const [r] = await pool.execute("SELECT * FROM users ORDER BY joined_at DESC");        res.json(r); } catch(e){ res.status(500).json({error:e.message}); }});
app.get("/admin/donors",   async (req, res) => { try { const [r] = await pool.execute("SELECT * FROM donors ORDER BY created_at DESC");      res.json(r); } catch(e){ res.status(500).json({error:e.message}); }});
app.get("/admin/sos",      async (req, res) => { try { const [r] = await pool.execute("SELECT * FROM sos_requests ORDER BY posted_at DESC"); res.json(r); } catch(e){ res.status(500).json({error:e.message}); }});
app.get("/admin/camps",    async (req, res) => { try { const [r] = await pool.execute("SELECT * FROM camps ORDER BY date ASC");              res.json(r); } catch(e){ res.status(500).json({error:e.message}); }});
app.get("/admin/donations", async (req, res) => { try { const [r] = await pool.execute("SELECT * FROM donations ORDER BY created_at DESC LIMIT 200"); res.json(r); } catch(e){ res.status(500).json({error:e.message}); }});

app.delete("/admin/camp/:id", async (req, res) => {
  try {
    await pool.execute("DELETE FROM camp_bookings WHERE camp_id = ?", [req.params.id]);
    await pool.execute("DELETE FROM camps WHERE id = ?", [req.params.id]);
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/consult/:id", async (req, res) => {
  try {
    const { status } = req.body;
    await pool.execute("UPDATE consults SET status=? WHERE id=?", [status||"done", req.params.id]);
    const [rows] = await pool.execute("SELECT * FROM consults WHERE id=?", [req.params.id]);
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/admin/consults", async (req, res) => { try { const [r] = await pool.execute("SELECT * FROM consults ORDER BY created_at DESC");    res.json(r); } catch(e){ res.status(500).json({error:e.message}); }});

app.get("/admin/donations", async (req, res) => {
  try { const [r] = await pool.execute("SELECT * FROM donations ORDER BY created_at DESC LIMIT 200"); res.json(r); }
  catch(e){ res.status(500).json({error:e.message}); }
});

app.delete("/admin/camp/:id", async (req, res) => {
  try {
    await pool.execute("DELETE FROM camp_bookings WHERE camp_id = ?", [req.params.id]);
    await pool.execute("DELETE FROM camps WHERE id = ?", [req.params.id]);
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/consult/:id", async (req, res) => {
  try {
    const { status } = req.body;
    await pool.execute("UPDATE consults SET status=? WHERE id=?", [status||"done", req.params.id]);
    const [rows] = await pool.execute("SELECT * FROM consults WHERE id=?", [req.params.id]);
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/admin/donor/:id", async (req, res) => {
  try {
    await pool.execute("DELETE FROM donors WHERE id = ?", [req.params.id]);
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/camp", async (req, res) => {
  try {
    const { name, date, location, total_slots, time } = req.body;
    const [result] = await pool.execute(
      "INSERT INTO camps (name, date, location, total_slots, time) VALUES (?,?,?,?,?)",
      [name, date, location, total_slots||50, time]
    );
    const [rows] = await pool.execute("SELECT * FROM camps WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


