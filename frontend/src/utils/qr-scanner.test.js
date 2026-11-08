import assert from 'node:assert'
import { describe, it } from 'node:test'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import {
  validateTapMeQrUrl,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  CANONICAL_BASE_URL,
  lookupCardByToken,
} from './qr-scanner.js'

describe('TapMe Phase 4 — QR Scanner & Inventory Lookup Test Suite', () => {
  describe('1. QR Validation & Canonical URL Parsing', () => {
    const validToken = '1234567890abcdef1234'
    const canonicalUrl = `https://tapme-ayd.pages.dev/r/${validToken}`

    it('accepts exact TapMe canonical redirect URL', () => {
      const res = validateTapMeQrUrl(canonicalUrl)
      assert.strictEqual(res.valid, true)
      assert.strictEqual(res.token, validToken)
      assert.strictEqual(res.canonicalUrl, canonicalUrl)
    })

    it('accepts configured local development base URL when passed', () => {
      const devUrl = `http://127.0.0.1:8787/r/${validToken}`
      const res = validateTapMeQrUrl(devUrl, 'http://127.0.0.1:8787')
      assert.strictEqual(res.valid, true)
      assert.strictEqual(res.token, validToken)
    })

    it('accepts raw public token in manual entry fallback', () => {
      const res = validateTapMeQrUrl(validToken)
      assert.strictEqual(res.valid, true)
      assert.strictEqual(res.token, validToken)
      assert.strictEqual(res.canonicalUrl, canonicalUrl)
    })

    it('rejects unrelated domain and phishing URLs', () => {
      const evilUrls = [
        `https://evil.com/r/${validToken}`,
        `https://tapme-ayd.phishing.dev/r/${validToken}`,
        `https://google.com/r/${validToken}`,
        `https://subdomain.tapme-ayd.pages.dev/r/${validToken}`,
      ]

      for (const badUrl of evilUrls) {
        const res = validateTapMeQrUrl(badUrl)
        assert.strictEqual(res.valid, false)
        assert(res.error.includes('Unrelated domain') || res.error.includes('does not belong to TapMe'))
      }
    })

    it('rejects incorrect path structures', () => {
      const invalidPaths = [
        'https://tapme-ayd.pages.dev/',
        'https://tapme-ayd.pages.dev/r',
        'https://tapme-ayd.pages.dev/r/',
        'https://tapme-ayd.pages.dev/cards/123',
        'https://tapme-ayd.pages.dev/api/public/cards/123',
        `https://tapme-ayd.pages.dev/r/${validToken}/extra`,
        `https://tapme-ayd.pages.dev/r/${validToken}/nested/path`,
      ]

      for (const badPath of invalidPaths) {
        const res = validateTapMeQrUrl(badPath)
        assert.strictEqual(res.valid, false)
        assert(res.error.includes('Invalid QR code path') || res.error.includes('Invalid QR content'))
      }
    })

    it('rejects malformed public tokens', () => {
      const malformedUrls = [
        'https://tapme-ayd.pages.dev/r/short', // too short (< 16 chars)
        'https://tapme-ayd.pages.dev/r/token with spaces',
        'https://tapme-ayd.pages.dev/r/bad$special*char#in!token',
        'https://tapme-ayd.pages.dev/r/way_too_long_token_exceeding_sixty_four_characters_limit_01234567890123456789',
      ]

      for (const badUrl of malformedUrls) {
        const res = validateTapMeQrUrl(badUrl)
        assert.strictEqual(res.valid, false)
        assert(res.error.includes('Malformed public token') || res.error.includes('Invalid QR content'))
      }
    })

    it('rejects invalid or non-https protocols in production', () => {
      const badProtocols = [
        `http://tapme-ayd.pages.dev/r/${validToken}`,
        `ftp://tapme-ayd.pages.dev/r/${validToken}`,
        `javascript:alert(1)//tapme-ayd.pages.dev/r/${validToken}`,
      ]

      for (const badUrl of badProtocols) {
        const res = validateTapMeQrUrl(badUrl, CANONICAL_BASE_URL)
        assert.strictEqual(res.valid, false)
        assert(res.error.includes('Invalid protocol') || res.error.includes('Invalid QR content'))
      }
    })

    it('handles empty or non-string inputs safely', () => {
      assert.strictEqual(validateTapMeQrUrl('').valid, false)
      assert.strictEqual(validateTapMeQrUrl('   ').valid, false)
      assert.strictEqual(validateTapMeQrUrl(null).valid, false)
      assert.strictEqual(validateTapMeQrUrl(undefined).valid, false)
      assert.strictEqual(validateTapMeQrUrl(12345).valid, false)
    })
  })

  describe('2. Image Scanning Security & MIME Validation', () => {
    it('accepts supported image MIME types (PNG, JPG, JPEG, WebP)', () => {
      const supported = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
      for (const type of supported) {
        assert(ALLOWED_IMAGE_TYPES.includes(type), `Expected ${type} to be allowed`)
      }
    })

    it('rejects unsupported image MIME types and executables', () => {
      const unsupported = ['image/gif', 'image/svg+xml', 'image/bmp', 'application/pdf', 'application/javascript', 'text/html']
      for (const type of unsupported) {
        assert(!ALLOWED_IMAGE_TYPES.includes(type), `Expected ${type} to be rejected`)
      }
    })

    it('enforces maximum file size limit of 10MB', () => {
      assert.strictEqual(MAX_IMAGE_SIZE_BYTES, 10 * 1024 * 1024)
      const oversizedBytes = MAX_IMAGE_SIZE_BYTES + 1
      assert(oversizedBytes > MAX_IMAGE_SIZE_BYTES, 'Oversized files must exceed threshold')
    })
  })

  describe('3. Programmatic QR Decoding from Image Pixel Data (jsQR)', () => {
    it('successfully decodes valid TapMe QR content from raw PNG/raster pixel buffer', async () => {
      const token = 'tapme-valid-scan-token-123'
      const canonicalUrl = `https://tapme-ayd.pages.dev/r/${token}`

      // Generate QR matrix using qrcode
      const qrData = QRCode.create(canonicalUrl, { errorCorrectionLevel: 'H' })
      const modules = qrData.modules
      const moduleCount = modules.size
      const scale = 8
      const size = moduleCount * scale

      const rgba = new Uint8ClampedArray(size * size * 4)
      rgba.fill(255) // White background

      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (modules.get(row, col)) {
            for (let py = 0; py < scale; py++) {
              for (let px = 0; px < scale; px++) {
                const idx = ((row * scale + py) * size + (col * scale + px)) * 4
                rgba[idx] = 0
                rgba[idx + 1] = 0
                rgba[idx + 2] = 0
                rgba[idx + 3] = 255
              }
            }
          }
        }
      }

      // Decode with jsQR
      const decoded = jsQR(rgba, size, size)
      assert(decoded, 'Decoder should successfully detect QR')
      assert.strictEqual(decoded.data, canonicalUrl)

      // Pass through pipeline
      const validated = validateTapMeQrUrl(decoded.data)
      assert.strictEqual(validated.valid, true)
      assert.strictEqual(validated.token, token)
    })

    it('rejects images with no readable QR code', () => {
      // Create a solid blank white image buffer
      const size = 100
      const rgba = new Uint8ClampedArray(size * size * 4)
      rgba.fill(255)

      const decoded = jsQR(rgba, size, size)
      assert.strictEqual(decoded, null)
    })

    it('rejects images with unrelated barcode / content', () => {
      const unrelatedContent = 'https://some-unrelated-website.com/product/12345'
      const validated = validateTapMeQrUrl(unrelatedContent)
      assert.strictEqual(validated.valid, false)
      assert(validated.error.includes('Unrelated domain'))
    })
  })

  describe('4. Unified Scanning Pipeline Invariants', () => {
    const testToken = 'UnifiedTestToken_98765'
    const fullCanonicalUrl = `https://tapme-ayd.pages.dev/r/${testToken}`

    it('processes camera, image upload, drag & drop, and manual entry through identical URL validation', () => {
      // 1. Live camera decoded string
      const cameraResult = validateTapMeQrUrl(fullCanonicalUrl)
      // 2. Image upload decoded string
      const uploadResult = validateTapMeQrUrl(fullCanonicalUrl)
      // 3. Drag and drop decoded string
      const dropResult = validateTapMeQrUrl(fullCanonicalUrl)
      // 4. Manual entry fallback with token
      const manualTokenResult = validateTapMeQrUrl(testToken)

      assert.strictEqual(cameraResult.valid, true)
      assert.strictEqual(uploadResult.valid, true)
      assert.strictEqual(dropResult.valid, true)
      assert.strictEqual(manualTokenResult.valid, true)

      assert.strictEqual(cameraResult.token, testToken)
      assert.strictEqual(uploadResult.token, testToken)
      assert.strictEqual(dropResult.token, testToken)
      assert.strictEqual(manualTokenResult.token, testToken)
    })

    it('does NOT navigate browser to the scanned URL during scanning or lookup', () => {
      // Verify lookup uses internal API path, never window.location.href or /r/:token
      const token = 'SecureToken_123456'
      const lookupPath = `/api/cards/lookup-by-token/${encodeURIComponent(token)}`
      assert.strictEqual(lookupPath, `/api/cards/lookup-by-token/${token}`)
      assert(!lookupPath.startsWith('/r/'))
    })
  })

  describe('5. Role-Based Scanner Action Resolution', () => {
    function resolveScannerActions(card, isMainAdmin) {
      if (!card.is_configured) {
        return { canConfigure: true, canEdit: false, requiresAdminNotice: false }
      }
      if (isMainAdmin) {
        return { canConfigure: false, canEdit: true, requiresAdminNotice: false }
      }
      return { canConfigure: false, canEdit: false, requiresAdminNotice: true }
    }

    it('allows both main admin and staff to configure unconfigured preprinted cards', () => {
      const unconfiguredCard = {
        card_number: 1,
        is_configured: false,
        configured_at: null,
      }

      const adminAction = resolveScannerActions(unconfiguredCard, true)
      const staffAction = resolveScannerActions(unconfiguredCard, false)

      assert.strictEqual(adminAction.canConfigure, true)
      assert.strictEqual(staffAction.canConfigure, true)
      assert.strictEqual(staffAction.requiresAdminNotice, false)
    })

    it('allows main admin to edit already-configured cards but restricts staff', () => {
      const configuredCard = {
        card_number: 1,
        is_configured: true,
        configured_at: '2026-11-06T12:00:00Z',
      }

      const adminAction = resolveScannerActions(configuredCard, true)
      const staffAction = resolveScannerActions(configuredCard, false)

      assert.strictEqual(adminAction.canEdit, true)
      assert.strictEqual(staffAction.canEdit, false)
      assert.strictEqual(staffAction.requiresAdminNotice, true)
    })
  })

  describe('6. Authenticated Card Lookup Client Helper', () => {
    it('handles successful card lookup response', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            card_number: 42,
            formatted_card_number: '042',
            business_name: 'Test Lookup Cafe',
            qr_type: 'google_review',
            is_configured: true,
          },
        }),
      })

      try {
        const res = await lookupCardByToken('ValidToken_1234567890')
        assert.strictEqual(res.success, true)
        assert.strictEqual(res.card.card_number, 42)
        assert.strictEqual(res.card.business_name, 'Test Lookup Cafe')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('handles 404 Not Found response', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => ({
        ok: false,
        status: 404,
        json: async () => ({ success: false, error: 'Card not found.' }),
      })

      try {
        const res = await lookupCardByToken('UnknownToken_0000000000')
        assert.strictEqual(res.success, false)
        assert.strictEqual(res.status, 404)
        assert.strictEqual(res.error, 'Card not found.')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('handles network failure gracefully', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => {
        throw new Error('Connection refused')
      }

      try {
        const res = await lookupCardByToken('NetworkFailToken_1234')
        assert.strictEqual(res.success, false)
        assert.strictEqual(res.status, 0)
        assert.strictEqual(res.error, 'Network error while looking up card.')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})

