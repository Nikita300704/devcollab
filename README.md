# DevCollab

A real-time collaborative code editor. Create a room, share the link, and write code together with live cursors, built-in team chat and (locally) multi-language code execution.

**Live demo:** __

## Features

- **Real-time collaboration:** several people edit the same file at once without overwriting each other (Yjs CRDT).
- **Live cursors and presence:** see who is online and where they are typing.
- **Team chat** inside each room, with history.
- **Google sign-in** (Clerk). The server verifies every user on every connection.
- **Persistent rooms:** code, chat, language and run history are stored in PostgreSQL.
- **"My rooms" dashboard:** reopen rooms you visited, review recent runs, delete rooms you own.
- **Run code** in JavaScript, Python, C and Java with a 5 s time limit (local use only, see Security).
- **Reconnection handling:** the editor recovers and re-syncs after connection drops.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript |
| Editor | Monaco Editor |
| Real-time sync | Yjs, Socket.io |
| Backend | Node.js, Express |
| Database | PostgreSQL (Neon) with `pg` |
| Auth | Clerk (Google OAuth, JWT verification on the server) |

## How it works

```
Browser (Next.js + Monaco)
   |  Yjs updates, chat, presence over WebSocket (Socket.io)
   v
Node server ---- verifies Clerk token on every connection
   |-- keeps each active room's Yjs document in memory
   |-- saves it to PostgreSQL (debounced, and on shutdown)
   '-- REST API: list/delete rooms, run history
```

- **Sync:** each browser holds a Yjs document. Edits become small binary updates that the server relays to the others. Yjs merges concurrent edits in any order, so everyone converges on the same text.
- **Persistence:** a room's document is loaded from PostgreSQL when the first person joins, and saved 2 seconds after the last change, when the room empties, and on server shutdown.
- **Security:** the server verifies the session token itself and never trusts a name sent by the browser. It also checks that a socket belongs to a room before accepting updates or messages, only accepts a fixed list of languages, and uses parameterised SQL queries.

## Run locally

Requirements: Node.js 20+, a Clerk application, a PostgreSQL database (for example Neon). Python, GCC and a JDK are optional (only needed to run those languages).

```bash
git clone https://github.com/YOUR-USERNAME/devcollab.git
cd devcollab

# server
cd server
npm install
# create server/.env  (see below)
node setup-db.js      # creates the tables
npm start

# client (new terminal)
cd client
npm install
# create client/.env.local  (see below)
npm run dev
```

Open http://localhost:3000.

**server/.env**
```
CLERK_SECRET_KEY=sk_test_...
DATABASE_URL=postgresql://...
FRONTEND_URL=http://localhost:3000
RUN_ENABLED=true
```

**client/.env.local**
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_SERVER_URL=http://localhost:4000
```

## Database

Four tables: `rooms` (document state, language), `messages`, `room_members` and `runs`, with foreign keys and `ON DELETE CASCADE`. See `server/schema.sql`.

## Security note: code execution

"Run" executes user-submitted code on the machine hosting the server. That is acceptable on localhost but **unsafe on a public server**, so the public demo sets `RUN_ENABLED=false`. A production version would run code in an isolated sandbox (containers with no network, CPU and memory limits, or a hosted execution service).

## Limitations and future work

- Any signed-in user who knows a room link can join it (no private rooms or invitations yet).
- Rooms are not distributed across multiple server instances (a Redis adapter would be needed to scale out).
- Sandboxed code execution.
- Automated tests.
