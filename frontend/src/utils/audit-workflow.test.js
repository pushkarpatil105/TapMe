import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUDIT_ACTIONS,
  formatAuditDateTime,
  getActionBadge,
  sanitizeAuditData,
  extractAuditItemMetadata,
  buildAuditQueryString,
} from './audit-workflow.js'

describe('TapMe Phase 6 — Audit Logs Workflow & Utilities Test Suite', () => {
  describe('1. Timestamp Formatting (Indian Standard Time - Asia/Kolkata)', () => {
    it('formats UTC SQLite timestamp strings into Asia/Kolkata locale string', () => {
      // 10:00:00 UTC = 15:30:00 IST (+5:30)
      const input = '2026-11-06 10:00:00'
      const formatted = formatAuditDateTime(input)

      assert.ok(formatted.includes('06'))
      assert.ok(formatted.includes('Nov'))
      assert.ok(formatted.includes('2026'))
      // 10:00 UTC + 5:30 = 03:30 PM (or 15:30 depending on locale format)
      assert.ok(formatted.includes('3:30') || formatted.includes('03:30') || formatted.includes('15:30'))
      assert.ok(formatted.toLowerCase().includes('pm'))
    })

    it('formats ISO 8601 UTC timestamps into Asia/Kolkata locale string', () => {
      const input = '2026-11-06T04:45:00.000Z'
      const formatted = formatAuditDateTime(input)

      assert.ok(formatted.includes('2026'))
      // 04:45 UTC + 5:30 = 10:15 AM
      assert.ok(formatted.includes('10:15'))
      assert.ok(formatted.toLowerCase().includes('am'))
    })

    it('safely handles empty or corrupted timestamp strings', () => {
      assert.strictEqual(formatAuditDateTime(null), '—')
      assert.strictEqual(formatAuditDateTime(undefined), '—')
      assert.strictEqual(formatAuditDateTime(''), '—')
      assert.strictEqual(formatAuditDateTime('not-a-timestamp'), 'not-a-timestamp')
    })
  })

  describe('2. Action Badge & Label Resolution', () => {
    it('defines all supported action types in AUDIT_ACTIONS', () => {
      const actionValues = AUDIT_ACTIONS.map((a) => a.value)
      assert.ok(actionValues.includes('card.created'))
      assert.ok(actionValues.includes('card.configured'))
      assert.ok(actionValues.includes('card.updated'))
      assert.ok(actionValues.includes('card.activated'))
      assert.ok(actionValues.includes('card.deactivated'))
      assert.ok(actionValues.includes('card.archived'))
      assert.ok(actionValues.includes('card.restored'))
      assert.ok(actionValues.includes('staff.created'))
      assert.ok(actionValues.includes('staff.deactivated'))
    })

    it('returns appropriate badge class and label for all known actions', () => {
      const created = getActionBadge('card.created')
      assert.strictEqual(created.label, 'Card Created')
      assert.strictEqual(created.badgeClass, 'audit-badge-emerald')

      const configured = getActionBadge('card.configured')
      assert.strictEqual(configured.label, 'Card Configured')
      assert.strictEqual(configured.badgeClass, 'audit-badge-sky')

      const updated = getActionBadge('card.updated')
      assert.strictEqual(updated.label, 'Card Updated')
      assert.strictEqual(updated.badgeClass, 'audit-badge-blue')

      const deactivated = getActionBadge('card.deactivated')
      assert.strictEqual(deactivated.label, 'Card Deactivated')
      assert.strictEqual(deactivated.badgeClass, 'audit-badge-amber')

      const archived = getActionBadge('card.archived')
      assert.strictEqual(archived.label, 'Card Archived')
      assert.strictEqual(archived.badgeClass, 'audit-badge-rose')

      const staffCreated = getActionBadge('staff.created')
      assert.strictEqual(staffCreated.label, 'Staff Created')

      const unknown = getActionBadge('custom.event')
      assert.strictEqual(unknown.label, 'custom.event')
      assert.strictEqual(unknown.badgeClass, 'audit-badge-slate')
    })
  })

  describe('3. Sensitive Data Sanitization', () => {
    it('removes passwords, password hashes, peppers, and session tokens', () => {
      const dirty = {
        username: 'alice',
        password: 'PlainTextPassword123!',
        password_hash: 'hash_secret_value',
        password_pepper: 'pepper_secret',
        session_token: 'session_xyz',
        public_token: 'FCVoPXPuyjQEuibNCuTPN5w7',
        nested: {
          token_hash: 'token_hash_abc',
          role: 'staff',
        },
      }

      const clean = sanitizeAuditData(dirty)
      assert.strictEqual(clean.username, 'alice')
      assert.strictEqual(clean.public_token, 'FCVoPXPuyjQEuibNCuTPN5w7')
      assert.strictEqual(clean.password, undefined)
      assert.strictEqual(clean.password_hash, undefined)
      assert.strictEqual(clean.password_pepper, undefined)
      assert.strictEqual(clean.session_token, undefined)
      assert.strictEqual(clean.nested.token_hash, undefined)
      assert.strictEqual(clean.nested.role, 'staff')
    })

    it('preserves primitive non-object values safely', () => {
      assert.strictEqual(sanitizeAuditData(null), null)
      assert.strictEqual(sanitizeAuditData('test'), 'test')
      assert.strictEqual(sanitizeAuditData(123), 123)
    })
  })

  describe('4. Metadata Extraction Without Historical Data Fabrication', () => {
    it('extracts card number and business name when available in details', () => {
      const log = {
        action: 'card.created',
        entity_type: 'card',
        entity_id: '6',
        details: {
          card_number: 6,
          business_name: 'Yo Cafe',
          qr_type: 'instagram',
          links: [],
        },
      }

      const meta = extractAuditItemMetadata(log)
      assert.strictEqual(meta.formattedCardNumber, '#006')
      assert.strictEqual(meta.businessName, 'Yo Cafe')
      assert.ok(meta.summary.includes('unconfigured'))
    })

    it('does NOT fabricate business name when not present in details', () => {
      const log = {
        action: 'card.deactivated',
        entity_type: 'card',
        entity_id: '4',
        details: {
          previous_status: 'active',
          new_status: 'inactive',
          card_number: 4,
        },
      }

      const meta = extractAuditItemMetadata(log)
      assert.strictEqual(meta.formattedCardNumber, '#004')
      assert.strictEqual(meta.businessName, null)
      assert.strictEqual(meta.summary, 'Card status changed to inactive')
    })

    it('extracts updated business name from changes payload', () => {
      const log = {
        action: 'card.updated',
        entity_type: 'card',
        entity_id: '8',
        details: {
          card_number: 8,
          changed_fields: ['business_name'],
          changes: {
            business_name: { before: 'Old Bakery', after: 'New Bakery' },
          },
        },
      }

      const meta = extractAuditItemMetadata(log)
      assert.strictEqual(meta.formattedCardNumber, '#008')
      assert.strictEqual(meta.businessName, 'New Bakery')
      assert.ok(meta.summary.includes('business_name'))
    })
  })

  describe('5. Query String Builder', () => {
    it('builds canonical search query parameters without empty keys', () => {
      const query = buildAuditQueryString({
        page: 2,
        limit: 50,
        action: 'card.created',
        search: 'Bakery',
        startDate: '2026-11-01',
        endDate: '2026-11-06',
      })

      assert.ok(query.startsWith('?'))
      assert.ok(query.includes('page=2'))
      assert.ok(query.includes('limit=50'))
      assert.ok(query.includes('action=card.created'))
      assert.ok(query.includes('search=Bakery'))
      assert.ok(query.includes('start_date=2026-11-01'))
      assert.ok(query.includes('end_date=2026-11-06'))
    })

    it('omits defaults and empty fields', () => {
      const query = buildAuditQueryString({
        page: 1,
        limit: 20,
        action: '',
        search: '   ',
      })

      assert.strictEqual(query, '')
    })
  })
})

