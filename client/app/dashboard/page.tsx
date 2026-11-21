"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, UserButton } from "@clerk/nextjs";

const API = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000";

type RoomItem = {
  id: string;
  language: string;
  isOwner: boolean;
  messageCount: number;
  lastVisited: string;
  updatedAt: string;
};

type RunItem = {
  id: string;
  roomId: string;
  language: string;
  ok: boolean;
  output: string;
  createdAt: string;
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function Dashboard() {
  const router = useRouter();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [code, setCode] = useState<string>("");

  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await getTokenRef.current();
        const headers = { Authorization: `Bearer ${token}` };
        const [r1, r2] = await Promise.all([
          fetch(`${API}/api/rooms`, { headers }),
          fetch(`${API}/api/runs`, { headers }),
        ]);
        if (!r1.ok || !r2.ok) throw new Error("Request failed");
        const [roomsData, runsData] = await Promise.all([r1.json(), r2.json()]);
        if (!cancelled) {
          setRooms(roomsData);
          setRuns(runsData);
        }
      } catch {
        if (!cancelled) setError("Could not load your data. Is the server running?");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  function createRoom() {
    const roomId = Math.random().toString(36).slice(2, 8);
    router.push(`/room/${roomId}`);
  }

  function joinRoom() {
    const clean = code.trim().replace(/[^\w-]/g, "").slice(0, 40);
    if (clean) router.push(`/room/${clean}`);
  }

  async function deleteRoom(id: string) {
    if (!confirm(`Delete room ${id}? This removes its code, chat and run history.`)) {
      return;
    }
    try {
      const token = await getTokenRef.current();
      const res = await fetch(`${API}/api/rooms/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("failed");
      setRooms((prev) => prev.filter((r) => r.id !== id));
      setRuns((prev) => prev.filter((x) => x.roomId !== id));
    } catch {
      alert("Could not delete this room.");
    }
  }

  return (
    <div className="dash">
      <nav className="nav">
        <Link href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>
          <span className="logo-dot" /> DevCollab
        </Link>
        <UserButton />
      </nav>

      <div className="dash-inner">
        <div className="dash-head">
          <h1>
            My <span className="grad-text">rooms</span>
          </h1>
          <div className="dash-actions">
            <button className="btn-primary" onClick={createRoom}>
              + New room
            </button>
            <div className="join-box">
              <input
                className="input"
                placeholder="Room code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
              />
              <button className="btn-outline" onClick={joinRoom}>
                Join
              </button>
            </div>
          </div>
        </div>

        {error && <p style={{ color: "#ff8a8a", marginTop: 20 }}>{error}</p>}

        <h2 className="section-title">Recent rooms</h2>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : rooms.length === 0 ? (
          <div className="glass empty">
            You haven&apos;t joined any rooms yet. Create one to get started.
          </div>
        ) : (
          <div className="room-grid">
            {rooms.map((r) => (
              <div key={r.id} className="glass room-card">
                <div className="row">
                  <span className="room-id">{r.id}</span>
                  {r.isOwner && <span className="pill">Owner</span>}
                </div>
                <div className="meta">
                  {r.language} · {r.messageCount} messages
                </div>
                <div className="meta">Last visited {timeAgo(r.lastVisited)}</div>
                <div className="card-actions">
                  <button
                    className="btn-primary"
                    onClick={() => router.push(`/room/${r.id}`)}
                  >
                    Open
                  </button>
                  {r.isOwner && (
                    <button className="btn-danger" onClick={() => deleteRoom(r.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 className="section-title">Recent runs</h2>
        {loading ? null : runs.length === 0 ? (
          <div className="glass empty">No runs yet. Press ▶ Run inside a room.</div>
        ) : (
          <div className="glass run-list">
            {runs.map((x) => (
              <div key={x.id} className="run-item">
                <span className="room-id" style={{ fontSize: 13 }}>
                  {x.roomId}
                </span>
                <span className={`badge ${x.ok ? "ok" : "err"}`}>
                  {x.ok ? "Success" : "Error"} · {x.language}
                </span>
                <span className="run-out">
                  {x.output.replace(/\s+/g, " ").trim() || "(no output)"}
                </span>
                <span className="meta">{timeAgo(x.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p style={{ padding: 40 }}>Loading...</p>}>
      <Dashboard />
    </Suspense>
  );
}