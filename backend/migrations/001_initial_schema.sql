CREATE TABLE uploaded_files (
    id SERIAL PRIMARY KEY,
    file_key TEXT NOT NULL UNIQUE,
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rooms (
    room_code TEXT PRIMARY KEY,
    host_participant_id TEXT NOT NULL,
    host_name TEXT NOT NULL,
    guest_participant_id TEXT,
    guest_name TEXT,
    host_screen_share_active BOOLEAN NOT NULL DEFAULT FALSE,
    guest_screen_share_active BOOLEAN NOT NULL DEFAULT FALSE,
    host_ready BOOLEAN NOT NULL DEFAULT FALSE,
    guest_ready BOOLEAN NOT NULL DEFAULT FALSE,
    host_file_count INTEGER NOT NULL DEFAULT 0,
    guest_file_count INTEGER NOT NULL DEFAULT 0,
    host_total_bytes BIGINT NOT NULL DEFAULT 0,
    guest_total_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_rooms_expires_at
ON rooms (expires_at);
