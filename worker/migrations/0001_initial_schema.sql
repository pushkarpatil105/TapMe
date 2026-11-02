-- 1. Admin accounts
CREATE TABLE admins (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('main_admin', 'staff')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT REFERENCES admins(id),
    last_login_at TEXT
);

-- 2. Cards
-- card_number is auto-generated and never manually edited.
-- Display it as 001, 002, 003, etc. in the application.
CREATE TABLE cards (
    card_number INTEGER PRIMARY KEY AUTOINCREMENT,
    public_token TEXT NOT NULL UNIQUE,
    business_name TEXT NOT NULL,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL REFERENCES admins(id),
    updated_by TEXT REFERENCES admins(id)
);

-- 3. Destination links belonging to cards
CREATE TABLE card_links (
    id TEXT PRIMARY KEY,
    card_number INTEGER NOT NULL REFERENCES cards(card_number),
    platform TEXT NOT NULL
        CHECK (platform IN ('google_reviews', 'instagram', 'whatsapp', 'other')),
    label TEXT NOT NULL,
    destination_url TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_enabled INTEGER NOT NULL DEFAULT 1
        CHECK (is_enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Scan analytics
CREATE TABLE scan_events (
    id TEXT PRIMARY KEY,
    card_number INTEGER NOT NULL REFERENCES cards(card_number),
    scanned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    referrer TEXT
);

-- 5. Login sessions
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admins(id),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Audit history
CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admins(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for frequently used queries
CREATE INDEX idx_cards_status ON cards(status);
CREATE INDEX idx_cards_business_name ON cards(business_name);
CREATE INDEX idx_card_links_card_number ON card_links(card_number);
CREATE INDEX idx_scan_events_card_number ON scan_events(card_number);
CREATE INDEX idx_scan_events_scanned_at ON scan_events(scanned_at);
CREATE INDEX idx_sessions_admin_id ON sessions(admin_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_audit_logs_admin_id ON audit_logs(admin_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Prevent changing a card's permanent identity
CREATE TRIGGER prevent_card_number_update
BEFORE UPDATE OF card_number ON cards
BEGIN
    SELECT RAISE(ABORT, 'Card number is permanent and cannot be changed');
END;

CREATE TRIGGER prevent_public_token_update
BEFORE UPDATE OF public_token ON cards
BEGIN
    SELECT RAISE(ABORT, 'Public token is permanent and cannot be changed');
END;