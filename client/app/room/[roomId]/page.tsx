"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";
import Editor, { OnMount, BeforeMount } from "@monaco-editor/react";
import { useAuth, useUser, UserButton } from "@clerk/nextjs";

type ChatMessage = { id: string; name: string; text: string; time: number };
type RunResult = { by: string; language: string; ok: boolean; output: string };
type Status = "connecting" | "connected" | "disconnected";
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000";

const COLORS = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231",
  "#911eb4", "#008080", "#f032e6", "#9a6324",
];

function colorFor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function Room() {
  const { roomId } = useParams();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const displayName = (user?.fullName || user?.username || "User").slice(0, 20);

  const [language, setLanguage] = useState<string>("javascript");
  const [ydoc] = useState(() => new Y.Doc());
  const [awareness] = useState(() => new Awareness(ydoc));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [input, setInput] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [runBy, setRunBy] = useState<string>("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [copied, setCopied] = useState<boolean>(false);
  const socketRef = useRef<Socket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  // colours other people's cursors
  useEffect(() => {
    const style = document.createElement("style");
    document.head.appendChild(style);

    const render = () => {
      let css = "";
      awareness.getStates().forEach((state, clientID) => {
        if (clientID === awareness.clientID || !state.user) return;
        const safeName = String(state.user.name).replace(/[^\w -]/g, "").slice(0, 20);
        const color = /^#[0-9a-fA-F]{6}$/.test(String(state.user.color))
          ? state.user.color
          : "#888888";
        css += `
.yRemoteSelection-${clientID} { background-color: ${color}55; }
.yRemoteSelectionHead-${clientID} {
  position: absolute; border-left: 2px solid ${color};
  height: 100%; box-sizing: border-box;
}
.yRemoteSelectionHead-${clientID}::after {
  content: "${safeName}"; position: absolute; top: -1.4em; left: -2px;
  background: ${color}; color: #fff; font-size: 11px;
  padding: 1px 4px; border-radius: 3px; white-space: nowrap;
}`;
      });
      style.textContent = css;
    };

    awareness.on("change", render);
    render();
    return () => {
      awareness.off("change", render);
      style.remove();
    };
  }, [awareness]);

  // main connection
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userLoaded) return;

    setStatus("connecting");
      const socket = io(SERVER_URL, {
      auth: async (cb) => {
        const token = await getTokenRef.current();
        cb({ token });
      },
    });
    socketRef.current = socket;

    awareness.setLocalState({
      user: { name: displayName, color: colorFor(displayName) },
    });

    const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote") {
        socket.emit("yjs-update", { roomId, update });
      }
    };
    ydoc.on("update", onLocalUpdate);

    const onAwarenessUpdate = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      if (origin === "remote") return;
      const changed = changes.added.concat(changes.updated, changes.removed);
      socket.emit("awareness-update", {
        roomId,
        update: encodeAwarenessUpdate(awareness, changed),
      });
    };
    awareness.on("update", onAwarenessUpdate);

    const sendOwnAwareness = () => {
      socket.emit("awareness-update", {
        roomId,
        update: encodeAwarenessUpdate(awareness, [awareness.clientID]),
      });
    };

    socket.on("connect", () => {
      setStatus("connected");
      socket.emit("join-room", { roomId });
      socket.emit("yjs-update", { roomId, update: Y.encodeStateAsUpdate(ydoc) });
      sendOwnAwareness();
    });

    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("connect_error", () => setStatus("disconnected"));

    socket.on("yjs-init", (state: ArrayBuffer) => {
      Y.applyUpdate(ydoc, new Uint8Array(state), "remote");
    });

    socket.on("yjs-update", (update: ArrayBuffer) => {
      Y.applyUpdate(ydoc, new Uint8Array(update), "remote");
    });

    socket.on("awareness-update", (update: ArrayBuffer) => {
      applyAwarenessUpdate(awareness, new Uint8Array(update), "remote");
    });

    socket.on("request-awareness", sendOwnAwareness);

    socket.on("chat-history", (history: ChatMessage[]) => {
      setMessages(history);
    });

    socket.on("chat-message", (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("room-users", (names: string[]) => {
      setUsers(names);
    });

    socket.on("language-change", (lang: string) => {
      setLanguage(lang);
    });

    socket.on("run-started", (data: { by: string }) => {
      setRunning(true);
      setRunBy(data.by);
    });

    socket.on("run-result", (data: RunResult) => {
      setRunning(false);
      setResult(data);
    });

    return () => {
      ydoc.off("update", onLocalUpdate);
      awareness.off("update", onAwarenessUpdate);
      awareness.setLocalState(null);
      socket.disconnect();
    };
  }, [roomId, ydoc, awareness, isLoaded, isSignedIn, userLoaded, displayName]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // custom purple editor theme, defined before the editor is created
  const handleBeforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme("devcollab", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0b0820",
        "editor.lineHighlightBackground": "#ffffff0d",
        "editorLineNumber.foreground": "#6b5fa5",
        "editorLineNumber.activeForeground": "#c4b5fd",
        "editorCursor.foreground": "#ff4fd8",
        "editor.selectionBackground": "#7c3aed55",
      },
    });
  };

  const handleMount: OnMount = async (editor) => {
    const { MonacoBinding } = await import("y-monaco");
    const ytext = ydoc.getText("code");
    new MonacoBinding(ytext, editor.getModel()!, new Set([editor]), awareness);
  };

  function sendMessage() {
    const text = input.trim();
    if (!text) return;
    socketRef.current?.emit("send-message", { roomId, text });
    setInput("");
  }

  function changeLanguage(lang: string) {
    socketRef.current?.emit("set-language", { roomId, language: lang });
  }

  function runCode() {
    socketRef.current?.emit("run-code", { roomId, language });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard can be blocked; ignore
    }
  }

  if (!isLoaded || !userLoaded) {
    return <p style={{ padding: 40 }}>Loading...</p>;
  }

  const statusColor =
    status === "connected" ? "#4ade80" : status === "connecting" ? "#f5a623" : "#ff6b6b";
  const statusText =
    status === "connected"
      ? "Connected"
      : status === "connecting"
           ? "Connecting... (server may be waking up)"
      : "Reconnecting...";

  return (
    <div className="room">
      <header className="topbar glass">
      <Link href="/dashboard" className="brand" style={{ color: "inherit", textDecoration: "none" }}>
      <span className="logo-dot" /> DevCollab
        </Link>

        <div className="room-info">
          <span className="pill">
            Room <b>{roomId}</b>
          </span>
          <button className="btn-ghost" onClick={copyLink}>
            {copied ? "Copied ✓" : "Copy invite link"}
          </button>
        </div>

        <div className="topbar-right">
          <span className="status">
            <span
              className="dot"
              style={{ background: statusColor, boxShadow: `0 0 10px ${statusColor}` }}
            />
            {statusText}
          </span>
          <div className="avatars">
            {users.map((u, i) => (
              <span
                key={`${u}-${i}`}
                className="avatar"
                style={{ background: colorFor(u) }}
                title={u}
              >
                {u.charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
          <UserButton />
        </div>
      </header>

      <div className="workspace">
        <section className="left">
          <div className="panel glass editor-panel">
            <div className="toolbar">
              <div className="toolbar-left">
                <select
                  className="select"
                  value={language}
                  onChange={(e) => changeLanguage(e.target.value)}
                >
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="c">C</option>
                  <option value="java">Java</option>
                </select>
                <span className="muted" style={{ fontSize: 13 }}>
                  {users.length} online
                </span>
              </div>
              <button
                className="btn-primary"
                onClick={runCode}
                disabled={running || status !== "connected"}
              >
                {running ? `Running (${runBy})...` : "▶ Run"}
              </button>
            </div>

            <div className="editor-wrap">
              <Editor
                height="100%"
                language={language}
                theme="devcollab"
                beforeMount={handleBeforeMount}
                onMount={handleMount}
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  padding: { top: 14 },
                  scrollBeyondLastLine: false,
                  fontFamily: "Consolas, Menlo, monospace",
                  automaticLayout: true,
                }}
              />
            </div>
          </div>

          <div className="panel glass output-panel">
            <div className="output-head">
              <span>Output</span>
              {result && (
                <span className={`badge ${result.ok ? "ok" : "err"}`}>
                  {result.ok ? "Success" : "Error"}
                </span>
              )}
            </div>
            <div className={`output-body ${result && !result.ok ? "err" : ""}`}>
              {result ? (
                <>
                  <div className="muted" style={{ marginBottom: 6 }}>
                    Run by {result.by} · {result.language}
                  </div>
                  {result.output}
                </>
              ) : (
                <span className="muted">Output will appear here. Click Run.</span>
              )}
            </div>
          </div>
        </section>

        <aside className="panel glass chat">
          <div className="chat-head">Team chat</div>
          <div className="chat-list">
            {messages.length === 0 && (
              <span className="muted" style={{ fontSize: 13 }}>
                No messages yet. Say hi 👋
              </span>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.name === displayName ? "mine" : ""}`}>
                <div className="who">
                  {m.name} ·{" "}
                  {new Date(m.time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                {m.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="chat-input">
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Type a message..."
            />
            <button className="btn-primary" onClick={sendMessage}>
              Send
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p style={{ padding: 40 }}>Loading room...</p>}>
      <Room />
    </Suspense>
  );
}