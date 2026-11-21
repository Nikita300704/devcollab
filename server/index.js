require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const Y = require("yjs");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { verifyToken, createClerkClient } = require("@clerk/backend");
const { pool } = require("./db");

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const RUN_ENABLED = process.env.RUN_ENABLED !== "false";

const app = express();
app.use(cors({ origin: FRONTEND_URL }));

// hosting platforms and uptime monitors call this to check the server is alive
app.get("/health", (req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: FRONTEND_URL },
});

pool
  .query("SELECT now()")
  .then(() => console.log("Database connected"))
  .catch((e) => console.error("Database connection FAILED:", e.message));

/* ---------- helpers ---------- */

// if an async handler throws, log it instead of crashing the whole server
const safe = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    console.error("handler error:", err.message);
  }
};

function rowToMessage(r) {
  return {
    id: String(r.id),
    name: r.user_name,
    text: r.text,
    time: r.created_at.getTime(),
  };
}

/* ---------- shared documents: memory cache + database ---------- */

const docs = new Map();        // roomId -> Promise<Y.Doc>  (cache of loaded rooms)
const dirty = new Set();       // rooms with changes not yet saved
const saveTimers = new Map();  // roomId -> debounce timer

function getDoc(roomId) {
  if (!docs.has(roomId)) {
    const promise = (async () => {
      const doc = new Y.Doc();
      const { rows } = await pool.query(
        "SELECT doc_state FROM rooms WHERE id = $1",
        [roomId]
      );
      if (rows[0] && rows[0].doc_state) {
        Y.applyUpdate(doc, new Uint8Array(rows[0].doc_state));
      }
      // from now on, every change schedules a save
      doc.on("update", () => scheduleSave(roomId));
      return doc;
    })().catch((err) => {
      docs.delete(roomId); // don't cache a failure
      throw err;
    });
    docs.set(roomId, promise);
  }
  return docs.get(roomId);
}

function scheduleSave(roomId) {
  dirty.add(roomId);
  clearTimeout(saveTimers.get(roomId));
  saveTimers.set(roomId, setTimeout(() => saveRoom(roomId), 2000));
}

async function saveRoom(roomId) {
  clearTimeout(saveTimers.get(roomId));
  saveTimers.delete(roomId);
  if (!dirty.has(roomId)) return;

  const pending = docs.get(roomId);
  if (!pending) return;
  const doc = await pending;

  dirty.delete(roomId);
  try {
    await pool.query(
      "UPDATE rooms SET doc_state = $1, updated_at = now() WHERE id = $2",
      [Buffer.from(Y.encodeStateAsUpdate(doc)), roomId]
    );
  } catch (err) {
    dirty.add(roomId); // try again next time
    console.error("save failed:", err.message);
  }
}

async function broadcastUsers(roomId) {
  const sockets = await io.in(roomId).fetchSockets();
  io.to(roomId).emit("room-users", sockets.map((s) => s.data.name));
}

/* ---------- code execution ---------- */

const running = new Set();
const isWin = process.platform === "win32";

function getConfig(language, dir) {
  if (language === "javascript") {
    return { file: "main.js", run: [process.execPath, ["main.js"]] };
  }
  if (language === "python") {
    return { file: "main.py", run: [isWin ? "python" : "python3", ["main.py"]] };
  }
  if (language === "c") {
    const exe = path.join(dir, isWin ? "main.exe" : "main");
    return {
      file: "main.c",
      compile: ["gcc", ["main.c", "-o", exe]],
      run: [exe, []],
    };
  }
  if (language === "java") {
    return {
      file: "Main.java",
      compile: ["javac", ["Main.java"]],
      run: ["java", ["Main"]],
    };
  }
  return null;
}

function runCommand(cmd, args, cwd) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    let timedOut = false;

    const child = spawn(cmd, args, { cwd });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 5000);

    const add = (current, chunk) => (current + chunk).slice(0, 10000);
    child.stdout.on("data", (d) => (stdout = add(stdout, d)));
    child.stderr.on("data", (d) => (stderr = add(stderr, d)));
    child.stdin.end();

    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const msg =
        err.code === "ENOENT"
          ? `"${cmd}" is not installed or not in your PATH`
          : err.message;
      resolve({ stdout, stderr: msg, code: 1, timedOut: false });
    });

    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

async function runCode(language, code) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "devcollab-"));
  try {
    const cfg = getConfig(language, dir);
    if (!cfg) return { ok: false, output: "Unsupported language" };

    await fs.promises.writeFile(path.join(dir, cfg.file), code);

    if (cfg.compile) {
      const c = await runCommand(cfg.compile[0], cfg.compile[1], dir);
      if (c.code !== 0) {
        return { ok: false, output: c.stderr || c.stdout || "Compile error" };
      }
    }

    const r = await runCommand(cfg.run[0], cfg.run[1], dir);
    if (r.timedOut) {
      return { ok: false, output: r.stdout + "\n[Stopped: took longer than 5 seconds]" };
    }
    return { ok: r.code === 0, output: r.stdout + r.stderr || "(no output)" };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/* ---------- authentication (shared by sockets and REST) ---------- */

// checks the token's signature and returns the user id
async function verifyUserId(token) {
  if (!token) throw new Error("no token");
  const res = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY,
  });
  const payload = res && res.data ? res.data : res;
  if (!payload || !payload.sub) throw new Error("invalid token");
  return payload.sub;
}

// same, plus the display name (needs one extra call to Clerk)
async function authenticate(token) {
  const userId = await verifyUserId(token);
  const user = await clerk.users.getUser(userId);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return {
    userId,
    name: (fullName || user.username || "User").slice(0, 20),
  };
}

io.use(async (socket, next) => {
  try {
    const { userId, name } = await authenticate(
      socket.handshake.auth && socket.handshake.auth.token
    );
    socket.data.userId = userId;
    socket.data.name = name;
    next();
  } catch (err) {
    console.log("auth failed:", err.message);
    next(new Error("auth failed"));
  }
});

// Express middleware: runs before the route and rejects anonymous requests
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    req.userId = await verifyUserId(token);
    next();
  } catch (err) {
    res.status(401).json({ error: "Unauthorized" });
  }
}

/* ---------- REST API ---------- */

// rooms this user has visited, newest first
app.get("/api/rooms", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.language, r.created_by, r.updated_at, m.last_visited,
              (SELECT COUNT(*) FROM messages WHERE room_id = r.id) AS message_count
       FROM room_members m
       JOIN rooms r ON r.id = m.room_id
       WHERE m.user_id = $1
       ORDER BY m.last_visited DESC
       LIMIT 50`,
      [req.userId]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        language: r.language,
        isOwner: r.created_by === req.userId,
        messageCount: Number(r.message_count),
        lastVisited: r.last_visited,
        updatedAt: r.updated_at,
      }))
    );
  } catch (err) {
    console.error("GET /api/rooms:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// this user's latest code runs
app.get("/api/runs", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, room_id, language, ok, left(output, 200) AS output, created_at
       FROM runs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.userId]
    );
    res.json(
      rows.map((r) => ({
        id: String(r.id),
        roomId: r.room_id,
        language: r.language,
        ok: r.ok,
        output: r.output || "",
        createdAt: r.created_at,
      }))
    );
  } catch (err) {
    console.error("GET /api/runs:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// delete a room: only its creator may do this
app.delete("/api/rooms/:id", requireAuth, async (req, res) => {
  try {
    const roomId = req.params.id;
    const { rowCount } = await pool.query(
      "DELETE FROM rooms WHERE id = $1 AND created_by = $2",
      [roomId, req.userId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Room not found, or not yours" });
    }

    // forget the in-memory copy and send everyone inside out
    clearTimeout(saveTimers.get(roomId));
    saveTimers.delete(roomId);
    dirty.delete(roomId);
    docs.delete(roomId);
    io.in(roomId).disconnectSockets(true);

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/rooms:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* ---------- sockets ---------- */

const ALLOWED_LANGUAGES = ["javascript", "python", "c", "java"];

io.on("connection", (socket) => {
  console.log("connected:", socket.data.name);

  socket.on(
    "join-room",
    safe(async ({ roomId }) => {
      if (typeof roomId !== "string" || !/^[\w-]{1,40}$/.test(roomId)) return;

      // join first, synchronously, so this socket's next events pass the room check
      socket.join(roomId);
      socket.data.roomId = roomId;

      // create the room if it is new
      await pool.query(
        `INSERT INTO rooms (id, created_by) VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [roomId, socket.data.userId]
      );

      // remember that this user visited this room
      await pool.query(
        `INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)
         ON CONFLICT (room_id, user_id) DO UPDATE SET last_visited = now()`,
        [roomId, socket.data.userId]
      );

      const doc = await getDoc(roomId);
      socket.emit("yjs-init", Y.encodeStateAsUpdate(doc));

      const lang = await pool.query(
        "SELECT language FROM rooms WHERE id = $1",
        [roomId]
      );
      socket.emit("language-change", lang.rows[0]?.language || "javascript");

      // last 100 messages, oldest first
      const history = await pool.query(
        `SELECT id, user_name, text, created_at FROM (
           SELECT * FROM messages WHERE room_id = $1
           ORDER BY created_at DESC, id DESC LIMIT 100
         ) AS recent
         ORDER BY created_at ASC, id ASC`,
        [roomId]
      );
      socket.emit("chat-history", history.rows.map(rowToMessage));

      await broadcastUsers(roomId);
      socket.to(roomId).emit("request-awareness");
    })
  );

  socket.on(
    "yjs-update",
    safe(async ({ roomId, update }) => {
      if (!socket.rooms.has(roomId)) return;
      const doc = await getDoc(roomId);
      Y.applyUpdate(doc, new Uint8Array(update));
      socket.to(roomId).emit("yjs-update", update);
    })
  );

  socket.on("awareness-update", ({ roomId, update }) => {
    if (!socket.rooms.has(roomId)) return;
    socket.to(roomId).emit("awareness-update", update);
  });

  socket.on(
    "set-language",
    safe(async ({ roomId, language }) => {
      if (!socket.rooms.has(roomId)) return;
      if (!ALLOWED_LANGUAGES.includes(language)) return;
      await pool.query("UPDATE rooms SET language = $1 WHERE id = $2", [
        language,
        roomId,
      ]);
      io.to(roomId).emit("language-change", language);
    })
  );

  socket.on(
    "run-code",
    safe(async ({ roomId, language }) => {
      if (!socket.rooms.has(roomId)) return;
      if (!ALLOWED_LANGUAGES.includes(language)) return;
            if (!RUN_ENABLED) {
        socket.emit("run-result", {
          by: "DevCollab",
          language,
          ok: false,
          output:
            "Running code is disabled on this public demo for security. Clone the repo and run it locally to try it.",
        });
        return;
      }
      if (running.has(roomId)) return;

      running.add(roomId);
      io.to(roomId).emit("run-started", { by: socket.data.name });

      let result;
      try {
        const doc = await getDoc(roomId);
        const code = doc.getText("code").toString();
        result = await runCode(language, code);
      } catch (err) {
        result = { ok: false, output: "Server error: " + err.message };
      } finally {
        running.delete(roomId);
      }

      io.to(roomId).emit("run-result", {
        by: socket.data.name,
        language,
        ok: result.ok,
        output: result.output,
      });

      // keep a record of the run (a failure here must not affect the room)
      try {
        await pool.query(
          `INSERT INTO runs (room_id, user_id, language, ok, output)
           VALUES ($1, $2, $3, $4, $5)`,
          [roomId, socket.data.userId, language, result.ok, result.output.slice(0, 5000)]
        );
      } catch (err) {
        console.error("could not save run:", err.message);
      }
    })
  );

  socket.on(
    "send-message",
    safe(async ({ roomId, text }) => {
      if (!socket.rooms.has(roomId)) return;
      if (typeof text !== "string") return;
      const clean = text.trim().slice(0, 500);
      if (!clean) return;

      const { rows } = await pool.query(
        `INSERT INTO messages (room_id, user_id, user_name, text)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_name, text, created_at`,
        [roomId, socket.data.userId, socket.data.name, clean]
      );
      io.to(roomId).emit("chat-message", rowToMessage(rows[0]));
    })
  );

  socket.on(
    "disconnect",
    safe(async () => {
      console.log("disconnected:", socket.data.name);
      const roomId = socket.data.roomId;
      if (!roomId) return;

      await broadcastUsers(roomId);

      // last person left: save now and free the memory
      const roomSize = () => io.sockets.adapter.rooms.get(roomId)?.size || 0;
      if (roomSize() === 0) {
        await saveRoom(roomId);
        if (roomSize() === 0) docs.delete(roomId);
      }
    })
  );
});

// Ctrl+C: save any unsaved rooms before stopping
async function shutdown() {
  console.log("Saving rooms before exit...");
  for (const id of [...dirty]) await saveRoom(id);
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);  // Ctrl+C on your PC
process.on("SIGTERM", shutdown); // hosting platforms stop apps with this signal

server.listen(PORT, () => console.log("Server running on port " + PORT));