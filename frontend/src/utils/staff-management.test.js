import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canManageStaff,
  canViewAuditLogs,
  getEffectiveStaffStatus,
  getAvailableStaffActions,
  validateStaffInput,
  formatStaffDate,
  getStaffActionConfig,
  parseStaffApiResponse,
  USERNAME_REGEX,
} from './staff-management.js'

describe('TapMe Phase 6.4 — Staff Management Frontend Test Suite', () => {
  describe('1. Role-Based Navigation & Permissions', () => {
    it('allows Main Admin to see Staff Management and Audit Logs', () => {
      const mainAdminUser = {
        id: 'admin-uuid-1',
        username: 'head_admin',
        role: 'main_admin',
      }

      assert.strictEqual(canManageStaff(mainAdminUser), true)
      assert.strictEqual(canViewAuditLogs(mainAdminUser), true)
    })

    it('forbids Staff Member from seeing Staff Management and Audit Logs', () => {
      const staffUser = {
        id: 'staff-uuid-2',
        username: 'staff_user',
        role: 'staff',
      }

      assert.strictEqual(canManageStaff(staffUser), false)
      assert.strictEqual(canViewAuditLogs(staffUser), false)
    })

    it('safely handles unauthenticated or null user contexts', () => {
      assert.strictEqual(canManageStaff(null), false)
      assert.strictEqual(canManageStaff(undefined), false)
      assert.strictEqual(canManageStaff({}), false)
      assert.strictEqual(canViewAuditLogs(null), false)
      assert.strictEqual(canViewAuditLogs(undefined), false)
    })
  })

  describe('2. Staff Account Status Resolution & Indicators', () => {
    it('identifies Active status when deleted_at is null and status is active', () => {
      const member = {
        id: 's-1',
        username: 'alice',
        status: 'active',
        deleted_at: null,
      }
      assert.strictEqual(getEffectiveStaffStatus(member), 'active')
    })

    it('identifies Disabled status when deleted_at is null and status is disabled', () => {
      const member = {
        id: 's-2',
        username: 'bob',
        status: 'disabled',
        deleted_at: null,
      }
      assert.strictEqual(getEffectiveStaffStatus(member), 'disabled')
    })

    it('identifies Removed status when deleted_at is populated, overriding status field', () => {
      const member = {
        id: 's-3',
        username: 'charlie',
        status: 'disabled',
        deleted_at: '2026-11-03 14:00:00',
      }
      assert.strictEqual(getEffectiveStaffStatus(member), 'removed')
    })
  })

  describe('3. Staff Lifecycle Available Actions & Suppression Rules', () => {
    it('permits only deactivation on active accounts', () => {
      const activeMember = {
        id: 's-1',
        username: 'alice',
        status: 'active',
        deleted_at: null,
      }
      const actions = getAvailableStaffActions(activeMember)
      assert.deepStrictEqual(actions, ['deactivate'])
    })

    it('permits activation and soft-removal on disabled accounts', () => {
      const disabledMember = {
        id: 's-2',
        username: 'bob',
        status: 'disabled',
        deleted_at: null,
      }
      const actions = getAvailableStaffActions(disabledMember)
      assert.deepStrictEqual(actions, ['activate', 'remove'])
    })

    it('strictly suppresses all actions for removed accounts (cannot be reactivated)', () => {
      const removedMember = {
        id: 's-3',
        username: 'charlie',
        status: 'disabled',
        deleted_at: '2026-11-03 12:00:00',
      }
      const actions = getAvailableStaffActions(removedMember)
      assert.deepStrictEqual(actions, [], 'Removed accounts must have zero available actions')
    })
  })

  describe('4. Create Staff Modal Validation', () => {
    it('rejects empty username', () => {
      const result = validateStaffInput({
        username: '   ',
        password: 'ValidPassword123!',
        confirmPassword: 'ValidPassword123!',
      })
      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Username is required.')
    })

    it('rejects usernames shorter than 3 characters', () => {
      const result = validateStaffInput({
        username: 'al',
        password: 'ValidPassword123!',
        confirmPassword: 'ValidPassword123!',
      })
      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Username must be at least 3 characters.')
    })

    it('rejects usernames longer than 50 characters', () => {
      const longName = 'a'.repeat(51)
      const result = validateStaffInput({
        username: longName,
        password: 'ValidPassword123!',
        confirmPassword: 'ValidPassword123!',
      })
      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Username cannot exceed 50 characters.')
    })

    it('rejects usernames with invalid characters (e.g. spaces, special symbols)', () => {
      const resultSpace = validateStaffInput({
        username: 'alice smith',
        password: 'ValidPassword123!',
        confirmPassword: 'ValidPassword123!',
      })
      assert.strictEqual(resultSpace.valid, false)

      const resultSymbol = validateStaffInput({
        username: 'alice#smith',
        password: 'ValidPassword123!',
        confirmPassword: 'ValidPassword123!',
      })
      assert.strictEqual(resultSymbol.valid, false)
    })

    it('accepts valid usernames conforming to USERNAME_REGEX', () => {
      assert(USERNAME_REGEX.test('alice'))
      assert(USERNAME_REGEX.test('alice_smith'))
      assert(USERNAME_REGEX.test('alice.smith'))
      assert(USERNAME_REGEX.test('alice-smith'))
      assert(USERNAME_REGEX.test('alice@branch'))
      assert(USERNAME_REGEX.test('staff_101'))
    })

    it('rejects missing password', () => {
      const result = validateStaffInput({
        username: 'valid_user',
        password: '',
        confirmPassword: '',
      })
      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Password is required.')
    })

    it('rejects password shorter than 12 characters', () => {
      const result = validateStaffInput({
        username: 'valid_user',
        password: 'ShortPass1!',
        confirmPassword: 'ShortPass1!',
      })
      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Password must be at least 12 characters.')
    })

    it('rejects mismatched password and confirmPassword', () => {
      const result = validateStaffInput({
        username: 'valid_user',
        password: 'Password123456!',
        confirmPassword: 'DifferentPassword123456!',
      })
      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Passwords do not match.')
    })

    it('accepts valid username and matching 12+ character password', () => {
      const result = validateStaffInput({
        username: 'valid_staff_member',
        password: 'SuperSecureStaffPassword2026!',
        confirmPassword: 'SuperSecureStaffPassword2026!',
      })
      assert.strictEqual(result.valid, true)
      assert.strictEqual(result.error, undefined)
    })
  })

  describe('5. Confirmation Modal Configurations', () => {
    const staff = { id: 's-10', username: 'eva_green' }

    it('provides accurate activation dialog configuration', () => {
      const config = getStaffActionConfig(staff, 'activate')
      assert.ok(config)
      assert.strictEqual(config.action, 'activate')
      assert.strictEqual(config.title, 'Activate Staff Account')
      assert(config.message.includes('eva_green'))
      assert.strictEqual(config.confirmText, 'Activate Account')
      assert.strictEqual(config.btnClass, 'action-btn-primary')
    })

    it('provides accurate deactivation dialog configuration with session revocation warning', () => {
      const config = getStaffActionConfig(staff, 'deactivate')
      assert.ok(config)
      assert.strictEqual(config.action, 'deactivate')
      assert.strictEqual(config.title, 'Deactivate Staff Account')
      assert(config.message.includes('All active login sessions will be revoked'))
      assert.strictEqual(config.confirmText, 'Deactivate Account')
      assert.strictEqual(config.btnClass, 'action-btn-warning')
    })

    it('provides accurate soft-removal dialog configuration with irreversible warning', () => {
      const config = getStaffActionConfig(staff, 'remove')
      assert.ok(config)
      assert.strictEqual(config.action, 'remove')
      assert.strictEqual(config.title, 'Remove Staff Account')
      assert(config.message.includes('removed accounts cannot be reactivated'))
      assert.strictEqual(config.confirmText, 'Remove Account')
      assert.strictEqual(config.btnClass, 'action-btn-danger')
    })
  })

  describe('6. API Failure & Security Error Handling', () => {
    it('handles 401 Unauthorized by detecting session expiration', () => {
      const result = parseStaffApiResponse(401, { error: 'Authentication required.' })
      assert.strictEqual(result.success, false)
      assert.strictEqual(result.isUnauthorized, true)
      assert.strictEqual(result.error, 'Session expired. Please log in again.')
    })

    it('handles 403 Forbidden by detecting permission denial', () => {
      const result = parseStaffApiResponse(403, {
        error: 'Main Admin permission required.',
      })
      assert.strictEqual(result.success, false)
      assert.strictEqual(result.isForbidden, true)
      assert.strictEqual(result.error, 'Main Admin permission required.')
    })

    it('handles 409 Conflict by detecting duplicate username errors', () => {
      const result = parseStaffApiResponse(409, {
        error: 'An account with this username already exists.',
      })
      assert.strictEqual(result.success, false)
      assert.strictEqual(result.isConflict, true)
      assert.strictEqual(result.error, 'An account with this username already exists.')
    })

    it('handles successful 200/201 responses cleanly', () => {
      const mockCreated = {
        id: 'new-id',
        username: 'new_staff',
        role: 'staff',
        status: 'active',
      }
      const result = parseStaffApiResponse(201, {
        success: true,
        data: mockCreated,
      })
      assert.strictEqual(result.success, true)
      assert.deepStrictEqual(result.data, mockCreated)
    })

    it('handles unexpected 500 error responses with safe fallback message', () => {
      const result = parseStaffApiResponse(500, null)
      assert.strictEqual(result.success, false)
      assert.strictEqual(result.error, 'An unexpected error occurred. Please try again.')
    })
  })

  describe('7. Safe Date Formatting', () => {
    it('returns null for empty date strings', () => {
      assert.strictEqual(formatStaffDate(null), null)
      assert.strictEqual(formatStaffDate(''), null)
    })

    it('formats valid ISO timestamps into locale date strings', () => {
      const formatted = formatStaffDate('2026-11-03T10:30:00Z')
      assert.ok(formatted)
      assert(typeof formatted === 'string')
    })

    it('safely returns the input on corrupted date strings', () => {
      assert.strictEqual(formatStaffDate('corrupt-date'), 'corrupt-date')
    })
  })
})

