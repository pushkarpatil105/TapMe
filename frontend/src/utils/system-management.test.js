import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  formatSystemDateTime,
  getStatusBadge,
  getSeverityBadge,
} from './system-management.js';

describe('TapMe Phase 7 — System Management & Diagnostics Frontend Utilities', () => {
  describe('1. Timestamp Formatting (Indian Standard Time - Asia/Kolkata)', () => {
    it('formats UTC SQLite timestamp strings into Asia/Kolkata locale string', () => {
      // 2026-11-06 10:00:00 UTC -> 3:30 PM IST (UTC+05:30)
      const istString = formatSystemDateTime('2026-11-06 10:00:00');
      assert.ok(istString.includes('06 Nov 2026') || istString.includes('6 Nov 2026'));
      assert.ok(istString.includes('03:30:00') || istString.includes('3:30:00'));
      assert.ok(istString.toLowerCase().includes('pm'));
    });

    it('formats ISO 8601 UTC timestamps into Asia/Kolkata locale string', () => {
      const istString = formatSystemDateTime('2026-11-06T04:30:00.000Z');
      // 04:30 UTC -> 10:00 AM IST
      assert.ok(istString.includes('10:00:00'));
      assert.ok(istString.toLowerCase().includes('am'));
    });

    it('safely handles empty or null timestamps', () => {
      assert.strictEqual(formatSystemDateTime(null), '—');
      assert.strictEqual(formatSystemDateTime(''), '—');
      assert.strictEqual(formatSystemDateTime(undefined), '—');
    });
  });

  describe('2. Operational Status Badges', () => {
    it('returns appropriate badge styling for operational status', () => {
      const badge = getStatusBadge('operational');
      assert.strictEqual(badge.label, 'Operational');
      assert.strictEqual(badge.badgeClass, 'status-pill-operational');
    });

    it('returns appropriate badge styling for degraded status', () => {
      const badge = getStatusBadge('degraded');
      assert.strictEqual(badge.label, 'Degraded');
      assert.strictEqual(badge.badgeClass, 'status-pill-degraded');
    });

    it('returns appropriate badge styling for unavailable status', () => {
      const badge = getStatusBadge('unavailable');
      assert.strictEqual(badge.label, 'Unavailable');
      assert.strictEqual(badge.badgeClass, 'status-pill-unavailable');
    });

    it('defaults unknown status safely', () => {
      const badge = getStatusBadge('something_else');
      assert.strictEqual(badge.label, 'Unknown');
      assert.strictEqual(badge.badgeClass, 'status-pill-unknown');
    });
  });

  describe('3. Severity Badges', () => {
    it('resolves severity labels correctly', () => {
      assert.strictEqual(getSeverityBadge('critical').label, 'CRITICAL');
      assert.strictEqual(getSeverityBadge('error').label, 'ERROR');
      assert.strictEqual(getSeverityBadge('warning').label, 'WARNING');
      assert.strictEqual(getSeverityBadge('info').label, 'INFO');
      assert.strictEqual(getSeverityBadge('unknown').label, 'INFO');
    });
  });
});

