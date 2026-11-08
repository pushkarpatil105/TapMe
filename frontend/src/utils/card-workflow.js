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

