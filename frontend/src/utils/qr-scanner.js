import jsQR from 'jsqr'

export const CANONICAL_BASE_URL = 'https://tapme-ayd.pages.dev'
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB limit

/**
 * Validates whether a scanned QR payload or manually entered string is an exact TapMe public redirect URL
 * (or a valid public token for manual entry fallback).
 *
 * Strict validation:
 * - Standard URL parser.
 * - Exact protocol (https: in production).
 * - Exact hostname match with canonical base URL (https://tapme-ayd.pages.dev or configured base URL).
 * - Path strictly matches `/r/<public_token>`.
 * - Public token format: 16 to 64 chars of [A-Za-z0-9_-].
 * - Rejects arbitrary domains, malformed tokens, unrelated URLs.
 *
 * @param {string} rawInput
 * @param {string|null} [customCanonicalBaseUrl]
 * @returns {{ valid: true; token: string; canonicalUrl: string } | { valid: false; error: string }}
 */
export function validateTapMeQrUrl(rawInput, customCanonicalBaseUrl = null) {
  if (!rawInput || typeof rawInput !== 'string') {
    return { valid: false, error: 'Empty or invalid QR content.' }
  }

  const raw = rawInput.trim()
  if (!raw) {
    return { valid: false, error: 'Empty QR content.' }
  }

  // Fallback support: direct token entry (16 to 64 base64url characters)
  if (/^[A-Za-z0-9_-]{16,64}$/.test(raw)) {
    return {
      valid: true,
      token: raw,
      canonicalUrl: `${CANONICAL_BASE_URL}/r/${raw}`,
    }
  }

  // Parse using standard URL parser
  let parsedUrl
  try {
    parsedUrl = new URL(raw)
  } catch {
    return {
      valid: false,
      error: 'Invalid QR content: not a valid URL or TapMe public token.',
    }
  }

  // Determine canonical reference
  const configuredBase =
    customCanonicalBaseUrl ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_REDIRECT_BASE_URL) ||
    CANONICAL_BASE_URL

  let refUrl
  try {
    refUrl = new URL(configuredBase)
  } catch {
    refUrl = new URL(CANONICAL_BASE_URL)
  }

  // 1. Protocol check
  if (parsedUrl.protocol !== refUrl.protocol) {
    return {
      valid: false,
      error: `Invalid protocol: "${parsedUrl.protocol}". Expected "${refUrl.protocol}".`,
    }
  }

  // 2. Hostname check: exact match with canonical base or production Pages domain
  const parsedHost = parsedUrl.hostname.toLowerCase()
  const refHost = refUrl.hostname.toLowerCase()
  const isHostMatch =
    parsedHost === refHost ||
    parsedHost === 'tapme-ayd.pages.dev'

  if (!isHostMatch) {
    return {
      valid: false,
      error: `Unrelated domain "${parsedHost}". This QR code does not belong to TapMe.`,
    }
  }

  // 3. Port check (if reference specifies a port, such as in local development)
  if (refUrl.port && parsedUrl.port !== refUrl.port) {
    return {
      valid: false,
      error: `Port mismatch. Expected port ${refUrl.port}.`,
    }
  }

  // 4. Expected path structure: strictly /r/<token> with no trailing or nested paths
  const pathMatch = parsedUrl.pathname.match(/^\/r\/([^/]+)$/)
  if (!pathMatch) {
    return {
      valid: false,
      error: 'Invalid QR code path. Expected a TapMe redirect URL (/r/<token>).',
    }
  }

  const token = pathMatch[1]

  // 5. Token format check (16-64 chars of [A-Za-z0-9_-])
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    return {
      valid: false,
      error: 'Malformed public token format in QR code.',
    }
  }

  return {
    valid: true,
    token,
    canonicalUrl: `${refUrl.origin}/r/${token}`,
  }
}

/**
 * Decodes a QR code from a user-supplied image file (PNG, JPG, JPEG, WebP) directly in the browser.
 *
 * Security & performance invariants:
 * - 100% client-side decoding using jsQR.
 * - Validates file type and file size (<10MB) before parsing.
 * - Handles corrupted images, unreadable formats, or zero-dimension images gracefully.
 * - Never uploads the image to the backend or any external server.
 * - Frees Object URLs and canvas memory after processing.
 *
 * @param {File|Blob} file
 * @returns {Promise<{ success: true; data: string } | { success: false; error: string }>}
 */
export async function decodeQrFromImageFile(file) {
  if (!file) {
    return { success: false, error: 'No image file selected.' }
  }

  // 1. Validate MIME type
  const mimeType = (file.type || '').toLowerCase()
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    return {
      success: false,
      error: 'Unsupported image format. Please select a PNG, JPG, JPEG, or WebP image.',
    }
  }

  // 2. Validate file size
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
    return {
      success: false,
      error: `Image file is too large (${sizeMb}MB). Maximum supported size is 10MB.`,
    }
  }

  // 3. Load image locally and decode
  return new Promise((resolve) => {
    let objectUrl = null
    try {
      objectUrl = URL.createObjectURL(file)
    } catch {
      resolve({ success: false, error: 'Failed to access local image file.' })
      return
    }

    const img = new Image()

    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width
        const height = img.naturalHeight || img.height

        if (!width || !height) {
          resolve({ success: false, error: 'Invalid image: zero width or height.' })
          return
        }

        const maxDimension = 4096
        let drawWidth = width
        let drawHeight = height
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height)
          drawWidth = Math.round(width * ratio)
          drawHeight = Math.round(height * ratio)
        }

        const canvas = document.createElement('canvas')
        canvas.width = drawWidth
        canvas.height = drawHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })

        if (!ctx) {
          resolve({ success: false, error: 'Browser canvas context could not be initialized.' })
          return
        }

        ctx.drawImage(img, 0, 0, drawWidth, drawHeight)
        const imageData = ctx.getImageData(0, 0, drawWidth, drawHeight)

        // Clear canvas references
        canvas.width = 0
        canvas.height = 0

        const code = jsQR(imageData.data, drawWidth, drawHeight, {
          inversionAttempts: 'attemptBoth',
        })

        if (!code || !code.data) {
          resolve({
            success: false,
            error: 'No readable QR code found in this image. Please ensure the QR code is clear and well-lit.',
          })
          return
        }

        resolve({ success: true, data: code.data })
      } catch (err) {
        resolve({
          success: false,
          error: `Error processing image: ${err?.message || 'unknown error'}`,
        })
      } finally {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl)
        }
      }
    }

    img.onerror = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
      resolve({
        success: false,
        error: 'Failed to decode image. The file may be corrupted or damaged.',
      })
    }

    img.src = objectUrl
  })
}

/**
 * Authenticated card lookup by public_token.
 * Uses GET /api/cards/lookup-by-token/:token.
 *
 * @param {string} token
 * @returns {Promise<{ success: true; card: any } | { success: false; error: string; status: number }>}
 */
export async function lookupCardByToken(token) {
  if (!token || typeof token !== 'string') {
    return { success: false, error: 'Card token is required.', status: 400 }
  }

  try {
    const response = await fetch(`/api/cards/lookup-by-token/${encodeURIComponent(token.trim())}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })

    const json = await response.json().catch(() => null)

    if (response.ok && json?.success && json?.data) {
      return { success: true, card: json.data }
    }

    return {
      success: false,
      error: json?.error || (response.status === 404 ? 'Card not found.' : 'Failed to look up card.'),
      status: response.status,
    }
  } catch {
    return {
      success: false,
      error: 'Network error while looking up card.',
      status: 0,
    }
  }
}
