/**
 * TapMe Preprinted Card Workflow Utilities & Business Logic
 *
 * Provides shared constants, validation rules, platform constraints,
 * and payload formatting for card creation and configuration.
 */

export const QR_TYPES = ['google_review', 'instagram', 'whatsapp', 'all_in_one']

export const QR_TYPE_CONFIG = {
  all_in_one: {
    label: 'All-in-One',
    allowedPlatforms: ['google_reviews', 'instagram', 'whatsapp', 'other'],
    maxLinks: 20,
    defaultPlatform: 'google_reviews',
    description: 'Multi-platform card supporting up to 20 destination links',
  },
  google_review: {
    label: 'Google Review',
    allowedPlatforms: ['google_reviews'],
    maxLinks: 1,
    defaultPlatform: 'google_reviews',
    description: 'Single destination for Google business reviews',
  },
  instagram: {
    label: 'Instagram',
    allowedPlatforms: ['instagram'],
    maxLinks: 1,
    defaultPlatform: 'instagram',
    description: 'Single destination for Instagram profile',
  },
  whatsapp: {
    label: 'WhatsApp',
    allowedPlatforms: ['whatsapp'],
    maxLinks: 1,
    defaultPlatform: 'whatsapp',
    description: 'Single destination for WhatsApp direct chat',
  },
}

export const QR_TYPE_OPTIONS = [
  { value: 'all_in_one', label: 'All-in-One' },
  { value: 'google_review', label: 'Google Review' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

export const CARD_TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All Cards' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'google_review', label: 'Google Reviews' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'all_in_one', label: 'Multi-link' },
]

export const PLATFORM_OPTIONS = [
  {
    value: 'google_reviews',
    label: 'Google Reviews',
    defaultLabel: 'Review Us on Google',
    placeholder: 'https://g.page/r/...',
  },
  {
    value: 'instagram',
    label: 'Instagram',
    defaultLabel: 'Follow Us on Instagram',
    placeholder: 'https://instagram.com/username',
  },
  {
    value: 'whatsapp',
    label: 'WhatsApp',
    defaultLabel: 'Message on WhatsApp',
    placeholder: 'https://wa.me/1234567890',
  },
  {
    value: 'other',
    label: 'Other / Website',
    defaultLabel: 'Visit Our Website',
    placeholder: 'https://example.com',
  },
]

/**
 * Validates a single URL string for protocol and syntax.
 */
export function isValidDestinationUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr.trim()) {
    return false
  }
  try {
    const parsed = new URL(urlStr.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Validates destination links against security rules and the card's QR type.
 */
export function validateLinksForCard(links, qrType) {
  const config = QR_TYPE_CONFIG[qrType] || QR_TYPE_CONFIG.all_in_one

  if (!Array.isArray(links)) {
    return 'Links must be an array.'
  }

  if (links.length > config.maxLinks) {
    return `${config.label} cards allow at most ${config.maxLinks} destination link(s).`
  }

  const seenUrls = new Set()
  const seenPlatforms = new Set()

  for (let i = 0; i < links.length; i++) {
    const l = links[i]
    if (!config.allowedPlatforms.includes(l.platform)) {
      return `Link platform '${l.platform}' is not permitted for ${config.label} cards.`
    }

    const url = typeof l.destination_url === 'string' ? l.destination_url.trim() : ''
    if (!url) {
      return `Link #${i + 1} (${l.platform}) requires a destination URL.`
    }

    if (!isValidDestinationUrl(url)) {
      return `Link #${i + 1} URL must start with http:// or https:// and be a valid URL.`
    }

    const lowerUrl = url.toLowerCase()
    if (seenUrls.has(lowerUrl)) {
      return `Duplicate destination URL found: "${url}". Each link must have a unique URL.`
    }
    seenUrls.add(lowerUrl)

    if (l.platform !== 'other') {
      if (seenPlatforms.has(l.platform)) {
        return `Only one "${l.platform.replace('_', ' ')}" link is permitted per card.`
      }
      seenPlatforms.add(l.platform)
    }
  }

  return null
}

/**
 * Validates the CreateCard form input before submission.
 */
export function validateCreateCardForm({ businessName, location, qrType, links }) {
  if (!businessName || !businessName.trim()) {
    return 'Business name is required.'
  }
  if (businessName.trim().length > 200) {
    return 'Business name cannot exceed 200 characters.'
  }
  if (location && location.trim().length > 200) {
    return 'Location cannot exceed 200 characters.'
  }
  if (!QR_TYPES.includes(qrType)) {
    return 'A valid QR type must be selected.'
  }

  // Preprinted cards with 0 links are valid and intentional
  if (!links || links.length === 0) {
    return null
  }

  return validateLinksForCard(links, qrType)
}

/**
 * Formats payload for POST /api/cards
 */
export function formatCreateCardPayload({ businessName, location, qrType, links }) {
  return {
    business_name: businessName.trim(),
    location: location?.trim() || null,
    qr_type: qrType,
    links: (links || []).map((l, idx) => ({
      platform: l.platform,
      destination_url: l.destination_url.trim(),
      label: l.label?.trim() || undefined,
      is_enabled: Boolean(l.is_enabled),
      display_order: idx,
    })),
  }
}

/**
 * Validates the EditCard / ConfigureCard form input before submission.
 */
export function validateEditCardForm({
  businessName,
  location,
  qrType,
  links,
  isMainAdmin,
  isConfigured,
}) {
  if (!businessName || !businessName.trim()) {
    return 'Business name is required.'
  }
  if (businessName.trim().length > 200) {
    return 'Business name cannot exceed 200 characters.'
  }
  if (location && location.trim().length > 200) {
    return 'Location cannot exceed 200 characters.'
  }

  // Staff permission guard
  if (!isMainAdmin && isConfigured) {
    return 'Staff members are not permitted to edit already-configured cards.'
  }

  // Staff configuring an unconfigured card must provide >= 1 destination link
  if (!isMainAdmin && (!links || links.length === 0)) {
    return 'At least one destination link is required to configure this card.'
  }

  // Main admin clearing links (0 links) is permitted
  if (!links || links.length === 0) {
    return null
  }

  return validateLinksForCard(links, qrType)
}

/**
 * Formats payload for PATCH /api/cards/:id
 * (Notice: qr_type is immutable and never included in edit payload)
 */
export function formatEditCardPayload({ businessName, location, links }) {
  return {
    business_name: businessName.trim(),
    location: location?.trim() || null,
    links: (links || []).map((l, idx) => ({
      platform: l.platform,
      destination_url: l.destination_url.trim(),
      label: l.label?.trim() || undefined,
      is_enabled: Boolean(l.is_enabled),
      display_order: idx,
    })),
  }
}

/**
 * Resolves the visual card type badge, label, and style class for an inventory card record.
 * Uses immutable qr_type and configured destination links without inferring from name.
 *
 * @param {Object} card - Card inventory record
 * @returns {{ type: string, label: string, badgeClass: string }}
 */
export function getCardTypeBadge(card) {
  if (!card) {
    return { type: 'unknown', label: 'Card', badgeClass: 'card-type-default' }
  }

  const qrType = (card.qr_type || '').toLowerCase()
  const links = Array.isArray(card.links)
    ? card.links
    : Array.isArray(card.card_links)
    ? card.card_links
    : []

  if (qrType === 'all_in_one' || links.length > 1) {
    return {
      type: 'all_in_one',
      label: 'Multi-link',
      badgeClass: 'card-type-multilink',
    }
  }

  if (qrType === 'google_review' || (links.length === 1 && links[0]?.platform === 'google_reviews')) {
    return {
      type: 'google_review',
      label: 'Google Reviews',
      badgeClass: 'card-type-googlereviews',
    }
  }

  if (qrType === 'instagram' || (links.length === 1 && links[0]?.platform === 'instagram')) {
    return {
      type: 'instagram',
      label: 'Instagram',
      badgeClass: 'card-type-instagram',
    }
  }

  if (qrType === 'whatsapp' || (links.length === 1 && links[0]?.platform === 'whatsapp')) {
    return {
      type: 'whatsapp',
      label: 'WhatsApp',
      badgeClass: 'card-type-whatsapp',
    }
  }

  return {
    type: qrType || 'unknown',
    label: QR_TYPE_CONFIG[qrType]?.label || 'Card',
    badgeClass: 'card-type-default',
  }
}

/**
 * Checks if a card matches the specified card type filter.
 *
 * @param {Object} card - Card inventory record
 * @param {string} typeFilter - Filter value ('', 'instagram', 'google_review', 'whatsapp', 'all_in_one')
 * @returns {boolean}
 */
export function matchesCardType(card, typeFilter) {
  if (!typeFilter || typeFilter === 'all' || typeFilter === '') {
    return true
  }
  if (!card) return false

  const qrType = (card.qr_type || '').toLowerCase()
  const links = Array.isArray(card.links)
    ? card.links
    : Array.isArray(card.card_links)
    ? card.card_links
    : []

  if (typeFilter === 'all_in_one') {
    return qrType === 'all_in_one' || links.length > 1
  }

  if (typeFilter === 'google_review') {
    return qrType === 'google_review' || links.some((l) => l?.platform === 'google_reviews')
  }

  if (typeFilter === 'instagram') {
    return qrType === 'instagram' || links.some((l) => l?.platform === 'instagram')
  }

  if (typeFilter === 'whatsapp') {
    return qrType === 'whatsapp' || links.some((l) => l?.platform === 'whatsapp')
  }

  return qrType === typeFilter
}

/**
 * Filters an array of card records using partial, case-insensitive matching
 * across business_name, location, card_number, and formatted_card_number,
 * and optionally filters by card type.
 *
 * @param {Array<Object>} cards - List of card records
 * @param {string} searchQuery - Search query string
 * @param {string} [typeFilter=''] - Optional card type filter identifier
 * @returns {Array<Object>} Filtered cards array
 */
export function filterCards(cards, searchQuery, typeFilter = '') {
  if (!Array.isArray(cards)) return []

  const hasSearch = typeof searchQuery === 'string' && searchQuery.trim().length > 0
  const q = hasSearch ? searchQuery.trim().toLowerCase() : ''
  const cleanNumQuery = q.startsWith('#') ? q.slice(1).trim() : q
  const hasTypeFilter = Boolean(typeFilter && typeFilter !== 'all')

  if (!hasSearch && !hasTypeFilter) {
    return [...cards]
  }

  return cards.filter((card) => {
    if (!card) return false

    // 1. Check card type filter if active
    if (hasTypeFilter && !matchesCardType(card, typeFilter)) {
      return false
    }

    // 2. Check search query if active
    if (!hasSearch) return true

    const name = (card.business_name || '').toLowerCase()
    if (name.includes(q)) return true

    const loc = (card.location || '').toLowerCase()
    if (loc.includes(q)) return true

    const numStr = String(card.card_number ?? '')
    if (numStr === q || numStr.includes(cleanNumQuery)) return true

    const formattedNum = (card.formatted_card_number || '').toLowerCase()
    if (formattedNum.includes(q) || formattedNum.includes(cleanNumQuery)) return true

    return false
  })
}

/**
 * Sorts an array of card records without mutating the input array.
 * Supports:
 * - 'created_desc' (Default): Newest first
 * - 'created_asc': Oldest first
 * - 'name_asc': Business name A to Z
 * - 'name_desc': Business name Z to A
 * - 'number_asc': Card number numeric ascending (1, 2, 10)
 * - 'number_desc': Card number numeric descending (10, 2, 1)
 *
 * @param {Array<Object>} cards - List of card records
 * @param {string} sortBy - Sort key identifier
 * @returns {Array<Object>} Sorted copy of cards
 */
export function sortCards(cards, sortBy = 'created_desc') {
  if (!Array.isArray(cards)) return []
  const copy = [...cards]

  switch (sortBy) {
    case 'created_asc':
      return copy.sort((a, b) => {
        const timeA = a?.created_at ? new Date(a.created_at).getTime() : 0
        const timeB = b?.created_at ? new Date(b.created_at).getTime() : 0
        return timeA - timeB
      })

    case 'name_asc':
      return copy.sort((a, b) => {
        const nameA = a?.business_name || ''
        const nameB = b?.business_name || ''
        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
      })

    case 'name_desc':
      return copy.sort((a, b) => {
        const nameA = a?.business_name || ''
        const nameB = b?.business_name || ''
        return nameB.localeCompare(nameA, undefined, { sensitivity: 'base' })
      })

    case 'number_asc':
      return copy.sort((a, b) => {
        const numA = Number(a?.card_number) || 0
        const numB = Number(b?.card_number) || 0
        return numA - numB
      })

    case 'number_desc':
      return copy.sort((a, b) => {
        const numA = Number(a?.card_number) || 0
        const numB = Number(b?.card_number) || 0
        return numB - numA
      })

    case 'created_desc':
    default:
      return copy.sort((a, b) => {
        const timeA = a?.created_at ? new Date(a.created_at).getTime() : 0
        const timeB = b?.created_at ? new Date(b.created_at).getTime() : 0
        return timeB - timeA
      })
  }
}

