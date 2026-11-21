CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL,
  language    TEXT NOT NULL DEFAULT 'javascript',
  doc_state   BYTEA,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages (room_id, created_at);

CREATE TABLE IF NOT EXISTS room_members (
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  last_visited  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON room_members (user_id, last_visited DESC);

CREATE TABLE IF NOT EXISTS runs (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  language    TEXT NOT NULL,
  ok          BOOLEAN NOT NULL,
  output      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);