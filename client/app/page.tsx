"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, UserButton, SignInButton } from "@clerk/nextjs";

export default function Home() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const [code, setCode] = useState<string>("");

  function createRoom() {
    const roomId = Math.random().toString(36).slice(2, 8);
    router.push(`/room/${roomId}`);
  }

  function joinRoom() {
    const clean = code.trim().replace(/[^\w-]/g, "").slice(0, 40);
    if (clean) router.push(`/room/${clean}`);
  }

  return (
    <div className="home">
      <div className="orb" style={{ width: 320, height: 320, background: "#7c3aed", top: 60, right: -60 }} />
      <div className="orb" style={{ width: 260, height: 260, background: "#ff2bd6", top: 420, left: -80, animationDelay: "2s" }} />

      <nav className="nav">
        <div className="brand">
          <span className="logo-dot" /> DevCollab
        </div>
                {isLoaded && isSignedIn && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn-ghost" onClick={() => router.push("/dashboard")}>
              My rooms
            </button>
            <UserButton />
          </div>
        )}
      </nav>

      <section className="hero">
        <div>
          <span className="pill">● Live · Multi-language · Built-in chat</span>
          <h1>
            Code together,
            <br />
            <span className="grad-text">in real time.</span>
          </h1>
          <p>
            Open a room, share the link and write code with your team at the same
            time. See every cursor, run your program, and talk without leaving the
            editor.
          </p>

          <div className="hero-actions">
            {!isLoaded ? null : isSignedIn ? (
              <>
                <button className="btn-primary" onClick={createRoom}>
                  Create room
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
              </>
            ) : (
              <SignInButton mode="modal">
                <button className="btn-primary">Get started with Google</button>
              </SignInButton>
            )}
          </div>
        </div>

        <div className="glass preview">
          <div className="win-bar">
            <span /> <span /> <span />
          </div>
          <div className="code">
            <div><span className="k">function</span> <span className="f">greet</span>(name) {"{"}</div>
            <div>&nbsp;&nbsp;<span className="k">return</span> <span className="s">`Hello, ${"{"}name{"}"}!`</span>;</div>
            <div>{"}"}</div>
            <div>&nbsp;</div>
            <div><span className="f">console</span>.log(<span className="f">greet</span>(<span className="s">"DevCollab"</span>));</div>
          </div>
          <span className="cursor-tag" style={{ background: "#e6194b", top: 92, right: 40 }}>Ava</span>
          <span className="cursor-tag" style={{ background: "#4363d8", bottom: 42, left: 120, animationDelay: "1.5s" }}>Sam</span>
        </div>
      </section>

      <section className="features">
        <div className="glass feature">
          <div className="icon">⚡</div>
          <h3>Live collaboration</h3>
          <p>Everyone edits the same file at once. Changes merge instantly with no overwriting.</p>
        </div>
        <div className="glass feature">
          <div className="icon">▶</div>
          <h3>Run code instantly</h3>
          <p>JavaScript, Python, C and Java. The output shows up for the whole room.</p>
        </div>
        <div className="glass feature">
          <div className="icon">💬</div>
          <h3>Team chat</h3>
          <p>Talk through the problem next to the code, with presence and live cursors.</p>
        </div>
      </section>
    </div>
  );
}