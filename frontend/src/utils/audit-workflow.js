/**
 * Utilities and formatting functions for the TapMe Audit Logs Dashboard (Phase 6).
 */

export const AUDIT_ACTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'card.created', label: 'Card Created' },
  { value: 'card.configured', label: 'Card Configured' },
  { value: 'card.updated', label: 'Card Updated' },
  { value: 'card.activated', label: 'Card Activated' },
  { value: 'card.deactivated', label: 'Card Deactivated' },
  { value: 'card.archived', label: 'Card Archived' },
  { value: 'card.restored', label: 'Card Restored' },
  { value: 'staff.created', label: 'Staff Created' },
  { value: 'staff.activated', label: 'Staff Activated' },
  { value: 'staff.deactivated', label: 'Staff Deactivated' },
  { value: 'staff.removed', label: 'Staff Removed' },
]

/**
 * Formats a UTC timestamp into Indian Standard Time (IST, Asia/Kolkata).
 * Input: "2026-11-06 10:13:10" or "2026-11-06T10:13:10.000Z"
 * Output: e.g. "06 Nov 2026, 03:43:10 PM"
 *
 * @param {string|null|undefined} timestamp
 * @returns {string}
 */
export function formatAuditDateTime(timestamp) {
  if (!timestamp || typeof timestamp !== 'string') return '—'

  try {
    const trimmed = timestamp.trim()
    // If the timestamp has no timezone offset (like SQLite's CURRENT_TIMESTAMP "YYYY-MM-DD HH:MM:SS"),
    // treat it as UTC by appending "Z"
    let normalized = trimmed
    const hasTimezone = /Z$/i.test(trimmed) || /[+-]\d{2}(?::?\d{2})?$/.test(trimmed)
    if (!hasTimezone) {
      normalized = trimmed.replace(' ', 'T') + 'Z'
    }

    const d = new Date(normalized)
    if (isNaN(d.getTime())) return timestamp

    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(d)
  } catch {
    return timestamp
  }
}

/**
 * Resolves action badge styling and human-readable label.
 *
 * @param {string} action
 * @returns {{ label: string; badgeClass: string; type: string }}
 */
export function getActionBadge(action) {
  switch (action) {
    case 'card.created':
      return { label: 'Card Created', badgeClass: 'audit-badge-emerald', type: 'create' }
    case 'card.configured':
      return { label: 'Card Configured', badgeClass: 'audit-badge-sky', type: 'configure' }
    case 'card.updated':
      return { label: 'Card Updated', badgeClass: 'audit-badge-blue', type: 'update' }
    case 'card.activated':
      return { label: 'Card Activated', badgeClass: 'audit-badge-emerald', type: 'lifecycle' }
    case 'card.deactivated':
      return { label: 'Card Deactivated', badgeClass: 'audit-badge-amber', type: 'lifecycle' }
    case 'card.archived':
      return { label: 'Card Archived', badgeClass: 'audit-badge-rose', type: 'lifecycle' }
    case 'card.restored':
      return { label: 'Card Restored', badgeClass: 'audit-badge-purple', type: 'lifecycle' }
    case 'staff.created':
      return { label: 'Staff Created', badgeClass: 'audit-badge-emerald', type: 'staff' }
    case 'staff.activated':
      return { label: 'Staff Activated', badgeClass: 'audit-badge-emerald', type: 'staff' }
    case 'staff.deactivated':
      return { label: 'Staff Deactivated', badgeClass: 'audit-badge-amber', type: 'staff' }
    case 'staff.removed':
      return { label: 'Staff Removed', badgeClass: 'audit-badge-rose', type: 'staff' }
    default:
      return { label: action || 'Unknown Action', badgeClass: 'audit-badge-slate', type: 'other' }
  }
}

/**
 * Strips sensitive fields (passwords, tokens, peppers, session keys) recursively.
 * Never displays passwords or secret keys.
 *
 * @param {unknown} data
 * @returns {unknown}
 */
export function sanitizeAuditData(data) {
  if (!data || typeof data !== 'object') {
    return data
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeAuditData(item))
  }

  const SENSITIVE_KEYS = new Set([
    'password',
    'password_hash',
    'password_pepper',
    'pepper',
    'token_hash',
    'session_token',
    'secret',
  ])

  const sanitized = {}
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      continue // Exclude sensitive field entirely
    }
    if (value && typeof value === 'object') {
      sanitized[key] = sanitizeAuditData(value)
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Extracts structured metadata from an audit row without fabricating missing historical data.
 *
 * @param {Object} log
 * @returns {{
 *   formattedCardNumber: string|null;
 *   businessName: string|null;
 *   summary: string;
 *   sanitizedDetails: unknown;
 * }}
 */
export function extractAuditItemMetadata(log) {
  const details = typeof log.details === 'object' && log.details !== null ? log.details : {}
  const sanitized = sanitizeAuditData(details)

  let formattedCardNumber = null
  let businessName = null
  let summary

  // 1. Resolve card number if applicable
  if (log.entity_type === 'card' && log.entity_id) {
    const rawNum = log.entity_id
    formattedCardNumber = /^\d+$/.test(rawNum)
      ? `#${String(rawNum).padStart(3, '0')}`
      : `Card ${rawNum}`
  } else if (details.card_number != null) {
    formattedCardNumber = `#${String(details.card_number).padStart(3, '0')}`
  }

  // 2. Resolve business name if available in details (never fabricated)
  if (typeof details.business_name === 'string' && details.business_name.trim()) {
    businessName = details.business_name.trim()
  } else if (details.changes?.business_name?.after) {
    businessName = String(details.changes.business_name.after).trim()
  }

  // 3. Construct human-readable activity summary
  switch (log.action) {
    case 'card.created': {
      const type = details.qr_type ? details.qr_type.replace('_', ' ') : 'card'
      const linksCount = details.links_count ?? (Array.isArray(details.links) ? details.links.length : 0)
      summary = `Created preprinted ${type} (${linksCount > 0 ? `${linksCount} link(s)` : 'unconfigured'})`
      break
    }
    case 'card.configured': {
      const fields = Array.isArray(details.changed_fields) ? details.changed_fields.join(', ') : 'destinations'
      summary = `Initial card configuration completed (${fields})`
      break
    }
    case 'card.updated': {
      const fields = Array.isArray(details.changed_fields) ? details.changed_fields.join(', ') : 'attributes'
      summary = `Card modified (${fields})`
      break
    }
    case 'card.activated':
      summary = 'Card status changed to active'
      break
    case 'card.deactivated':
      summary = 'Card status changed to inactive'
      break
    case 'card.archived':
      summary = 'Card moved to archive'
      break
    case 'card.restored':
      summary = 'Card restored from archive (status: inactive)'
      break
    case 'staff.created': {
      const username = details.username || log.entity_id || 'account'
      summary = `Staff account "${username}" created`
      break
    }
    case 'staff.activated': {
      const username = details.target_username || log.entity_id || 'account'
      summary = `Staff account "${username}" activated`
      break
    }
    case 'staff.deactivated': {
      const username = details.target_username || log.entity_id || 'account'
      summary = `Staff account "${username}" deactivated`
      break
    }
    case 'staff.removed': {
      const username = details.target_username || log.entity_id || 'account'
      summary = `Staff account "${username}" permanently soft-removed`
      break
    }
    default:
      summary = `Recorded ${log.action}`
      break
  }

  return {
    formattedCardNumber,
    businessName,
    summary,
    sanitizedDetails: sanitized,
  }
}

/**
 * Builds URL query parameters for GET /api/audit-logs
 *
 * @param {Object} params
 * @returns {string}
 */
export function buildAuditQueryString(params = {}) {
  const query = new URLSearchParams()

  if (params.page != null && params.page > 1) {
    query.set('page', String(params.page))
  }
  if (params.limit != null && params.limit !== 20) {
    query.set('limit', String(params.limit))
  }
  if (params.action && params.action.trim()) {
    query.set('action', params.action.trim())
  }
  if (params.search && params.search.trim()) {
    query.set('search', params.search.trim())
  }
  if (params.startDate && params.startDate.trim()) {
    query.set('start_date', params.startDate.trim())
  }
  if (params.endDate && params.endDate.trim()) {
    query.set('end_date', params.endDate.trim())
  }
  if (params.adminId && params.adminId.trim()) {
    query.set('admin_id', params.adminId.trim())
  }

  const str = query.toString()
  return str ? `?${str}` : ''
}
