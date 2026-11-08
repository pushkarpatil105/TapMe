-- Migration 0003: Preprinted reusable cards, QR types, and assignment tracking

-- 1. Add immutable qr_type column to cards table
-- Default to 'all_in_one' so existing production cards remain fully backward-compatible
ALTER TABLE cards ADD COLUMN qr_type TEXT NOT NULL DEFAULT 'all_in_one'
    CHECK (qr_type IN ('google_review', 'instagram', 'whatsapp', 'all_in_one'));

-- 2. Add nullable configured_at column to track initial destination assignment
ALTER TABLE cards ADD COLUMN configured_at TEXT;

-- 3. Backfill existing cards based on their destination links:
--    - Exactly 1 google_reviews link -> 'google_review'
--    - Exactly 1 instagram link -> 'instagram'
--    - Exactly 1 whatsapp link -> 'whatsapp'
--    - More than 1 link -> 'all_in_one'
--    - Exactly 1 'other' link (or unsupported combination) -> 'all_in_one' (safe fallback, manual review noted)
--    - 0 links -> 'all_in_one' (safe fallback, unassigned)
--
--    For configured_at:
--    - Cards with >= 1 destination link are marked configured using their created_at timestamp.
--    - Cards with 0 destination links remain unassigned (configured_at IS NULL).
UPDATE cards
SET
    qr_type = CASE
        WHEN (SELECT COUNT(*) FROM card_links WHERE card_links.card_number = cards.card_number) = 1
         AND (SELECT platform FROM card_links WHERE card_links.card_number = cards.card_number LIMIT 1) = 'google_reviews'
            THEN 'google_review'

        WHEN (SELECT COUNT(*) FROM card_links WHERE card_links.card_number = cards.card_number) = 1
         AND (SELECT platform FROM card_links WHERE card_links.card_number = cards.card_number LIMIT 1) = 'instagram'
            THEN 'instagram'

        WHEN (SELECT COUNT(*) FROM card_links WHERE card_links.card_number = cards.card_number) = 1
         AND (SELECT platform FROM card_links WHERE card_links.card_number = cards.card_number LIMIT 1) = 'whatsapp'
            THEN 'whatsapp'

        ELSE 'all_in_one'
    END,
    configured_at = CASE
        WHEN (SELECT COUNT(*) FROM card_links WHERE card_links.card_number = cards.card_number) > 0
            THEN COALESCE(cards.created_at, CURRENT_TIMESTAMP)
        ELSE NULL
    END;

-- 4. Create performance indexes
CREATE INDEX idx_cards_qr_type ON cards(qr_type);
CREATE INDEX idx_cards_configured_at ON cards(configured_at);

-- 5. Prevent updating the permanent qr_type
-- Created AFTER the backfill UPDATE so it does not block the initial migration classification
CREATE TRIGGER prevent_qr_type_update
BEFORE UPDATE OF qr_type ON cards
BEGIN
    SELECT RAISE(ABORT, 'QR type is permanent and cannot be changed');
END;

