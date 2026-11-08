/**
 * TapMe Phase 6.4 — Staff Management Utilities & Business Logic
 *
 * Provides shared validation, status evaluation, permission checks,
 * action configurations, and API response parsing for Staff Management.
 */

export const USERNAME_REGEX = /^[a-zA-Z0-9_.@-]{3,50}$/

/**
 * Checks whether an authenticated user has permission to manage staff.
 * Only 'main_admin' can manage staff.
 */
export function canManageStaff(user) {
  return Boolean(user && user.role === 'main_admin')
}

/**
 * Checks whether an authenticated user has permission to view audit logs.
 * Only 'main_admin' can view audit logs.
 */
export function canViewAuditLogs(user) {
  return Boolean(user && user.role === 'main_admin')
}

/**
 * Resolves the effective status of a staff member.
 * - 'removed': if deleted_at is set.
 * - 'active': if status is 'active' and not deleted.
 * - 'disabled': if status is 'disabled' and not deleted.
 */
export function getEffectiveStaffStatus(member) {
  if (!member) return 'disabled'
  if (member.deleted_at) {
    return 'removed'
  }
  return member.status === 'active' ? 'active' : 'disabled'
}

/**
 * Determines which administrative lifecycle actions are available for a staff account.
 * - Removed accounts: no actions available (cannot be reactivated or edited).
 * - Active accounts: ['deactivate']
 * - Disabled accounts: ['activate', 'remove']
 */
export function getAvailableStaffActions(member) {
  const status = getEffectiveStaffStatus(member)
  if (status === 'removed') {
    return []
  }
  if (status === 'active') {
    return ['deactivate']
  }
  if (status === 'disabled') {
    return ['activate', 'remove']
  }
  return []
}

/**
 * Validates staff account creation form inputs.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateStaffInput({ username, password, confirmPassword }) {
  if (typeof username !== 'string' || !username.trim()) {
    return { valid: false, error: 'Username is required.' }
  }

  const cleanUsername = username.trim()
  if (cleanUsername.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters.' }
  }

  if (cleanUsername.length > 50) {
    return { valid: false, error: 'Username cannot exceed 50 characters.' }
  }

  if (!USERNAME_REGEX.test(cleanUsername)) {
    return {
      valid: false,
      error: "Username must be 3-50 characters and may only contain letters, numbers, '.', '_', '-', or '@'.",
    }
  }

  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' }
  }

  if (password.length < 12) {
    return { valid: false, error: 'Password must be at least 12 characters.' }
  }

  if (password !== confirmPassword) {
    return { valid: false, error: 'Passwords do not match.' }
  }

  return { valid: true }
}

/**
 * Formats timestamps safely into user-friendly strings.
 */
export function formatStaffDate(dateStr) {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

/**
 * Generates dialog configurations for lifecycle actions (activate, deactivate, remove).
 */
export function getStaffActionConfig(staff, action) {
  const username = staff?.username || 'this user'

  const configs = {
    activate: {
      action: 'activate',
      title: 'Activate Staff Account',
      message: `Are you sure you want to activate the account for "${username}"? The staff member will be allowed to log in and manage cards.`,
      confirmText: 'Activate Account',
      btnClass: 'action-btn-primary',
      severity: 'normal',
    },
    deactivate: {
      action: 'deactivate',
      title: 'Deactivate Staff Account',
      message: `Are you sure you want to deactivate the account for "${username}"? All active login sessions will be revoked immediately and they will be prevented from logging in until reactivated.`,
      confirmText: 'Deactivate Account',
      btnClass: 'action-btn-warning',
      severity: 'warning',
    },
    remove: {
      action: 'remove',
      title: 'Remove Staff Account',
      message: `Are you sure you want to permanently remove "${username}"? The account will be soft-deleted and all active sessions will be revoked. Warning: Per security policy, removed accounts cannot be reactivated.`,
      confirmText: 'Remove Account',
      btnClass: 'action-btn-danger',
      severity: 'danger',
    },
  }

  return configs[action] || null
}

/**
 * Normalizes staff management API responses and errors.
 */
export function parseStaffApiResponse(status, json) {
  if (status === 401) {
    return {
      success: false,
      isUnauthorized: true,
      error: 'Session expired. Please log in again.',
    }
  }

  if (status === 403) {
    return {
      success: false,
      isForbidden: true,
      error: json?.error || 'Main Administrator permissions are required.',
    }
  }

  if (status === 409) {
    return {
      success: false,
      isConflict: true,
      error: json?.error || 'An account with this username already exists.',
    }
  }

  if (status >= 200 && status < 300 && json?.success) {
    return {
      success: true,
      data: json.data,
    }
  }

  return {
    success: false,
    error: json?.error || 'An unexpected error occurred. Please try again.',
  }
}

