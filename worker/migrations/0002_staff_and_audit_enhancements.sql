-- Migration 0002: Staff management and audit log enhancements

-- 1. Add nullable deleted_at column to admins table for safe soft removal
ALTER TABLE admins ADD COLUMN deleted_at TEXT;

-- 2. Add performance indexes for audit log filtering and queries
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type);

