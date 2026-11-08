import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  QR_TYPES,
  QR_TYPE_CONFIG,
  QR_TYPE_OPTIONS,
  PLATFORM_OPTIONS,
  isValidDestinationUrl,
  validateLinksForCard,
  validateCreateCardForm,
  formatCreateCardPayload,
  validateEditCardForm,
  formatEditCardPayload,
} from './card-workflow.js'
import { getPublicCardUrl } from './public-url.js'

describe('TapMe Phase 2B.1 — Card Workflow & Preprinted QR Frontend Test Suite', () => {
  describe('1. QR Type Selection & Payload Formatting', () => {
    it('defines the four supported immutable QR types', () => {
      assert.deepStrictEqual(QR_TYPES, [
        'google_review',
        'instagram',
        'whatsapp',
        'all_in_one',
      ])
      assert.strictEqual(QR_TYPE_OPTIONS.length, 4)
      assert.strictEqual(Object.keys(QR_TYPE_CONFIG).length, 4)
      assert.ok(PLATFORM_OPTIONS.length >= 4)
      for (const opt of QR_TYPE_OPTIONS) {
        assert.ok(QR_TYPES.includes(opt.value))
      }
    })

    it('validates destination URLs and links correctly', () => {
      assert.strictEqual(isValidDestinationUrl('https://example.com'), true)
      assert.strictEqual(isValidDestinationUrl('http://example.com/test'), true)
      assert.strictEqual(isValidDestinationUrl('ftp://example.com'), false)
      assert.strictEqual(isValidDestinationUrl('not-a-url'), false)
      assert.strictEqual(isValidDestinationUrl(''), false)

      // Test validateLinksForCard non-array handling
      assert.match(validateLinksForCard('not-array', 'all_in_one'), /Links must be an array/i)
    })

    it('explicitly includes the selected qr_type in POST /api/cards payload', () => {
      for (const qrType of QR_TYPES) {
        const payload = formatCreateCardPayload({
          businessName: 'Acme Test Store',
          location: 'New York, NY',
          qrType,
          links: [],
        })

        assert.strictEqual(payload.business_name, 'Acme Test Store')
        assert.strictEqual(payload.location, 'New York, NY')
        assert.strictEqual(payload.qr_type, qrType)
        assert.deepStrictEqual(payload.links, [])
      }
    })

    it('rejects card creation when qr_type is missing or invalid', () => {
      const errMissing = validateCreateCardForm({
        businessName: 'Acme Store',
        location: null,
        qrType: '',
        links: [],
      })
      assert.match(errMissing, /A valid QR type must be selected/i)

      const errInvalid = validateCreateCardForm({
        businessName: 'Acme Store',
        location: null,
        qrType: 'tiktok',
        links: [],
      })
      assert.match(errInvalid, /A valid QR type must be selected/i)
    })
  })

  describe('2. Zero-Link Preprinted Card Creation (Staff Workflow)', () => {
    it('allows card creation with zero destination links', () => {
      for (const qrType of QR_TYPES) {
        const validationError = validateCreateCardForm({
          businessName: 'Preprinted Batch Card',
          location: null,
          qrType,
          links: [],
        })
        assert.strictEqual(validationError, null)

        const payload = formatCreateCardPayload({
          businessName: 'Preprinted Batch Card',
          location: null,
          qrType,
          links: [],
        })
        assert.strictEqual(payload.links.length, 0)
        assert.strictEqual(payload.qr_type, qrType)
      }
    })

    it('does not require destination URLs when creating an unconfigured card', () => {
      const result = validateCreateCardForm({
        businessName: 'Unconfigured Preprinted Card',
        location: 'Miami, FL',
        qrType: 'google_review',
        links: [],
      })
      assert.strictEqual(result, null)
    })

    it('validates business name requirements even with zero links', () => {
      const emptyNameErr = validateCreateCardForm({
        businessName: '   ',
        location: null,
        qrType: 'all_in_one',
        links: [],
      })
      assert.match(emptyNameErr, /Business name is required/i)

      const longNameErr = validateCreateCardForm({
        businessName: 'A'.repeat(201),
        location: null,
        qrType: 'all_in_one',
        links: [],
      })
      assert.match(longNameErr, /cannot exceed 200 characters/i)
    })
  })

  describe('3. Single-Purpose Platform Restrictions (Creation)', () => {
    it('allows google_review cards to have zero or exactly one google_reviews link', () => {
      // 0 links allowed
      assert.strictEqual(
        validateCreateCardForm({
          businessName: 'Cafe Google',
          qrType: 'google_review',
          links: [],
        }),
        null
      )

      // 1 matching link allowed
      assert.strictEqual(
        validateCreateCardForm({
          businessName: 'Cafe Google',
          qrType: 'google_review',
          links: [
            {
              platform: 'google_reviews',
              destination_url: 'https://g.page/r/12345/review',
              label: 'Review Us',
              is_enabled: true,
            },
          ],
        }),
        null
      )

      // Mismatched platform rejected
      const mismatchErr = validateCreateCardForm({
        businessName: 'Cafe Google',
        qrType: 'google_review',
        links: [
          {
            platform: 'instagram',
            destination_url: 'https://instagram.com/cafegoogle',
            label: 'Instagram',
            is_enabled: true,
          },
        ],
      })
      assert.match(mismatchErr, /not permitted for Google Review cards/i)

      // More than 1 link rejected
      const multiErr = validateCreateCardForm({
        businessName: 'Cafe Google',
        qrType: 'google_review',
        links: [
          {
            platform: 'google_reviews',
            destination_url: 'https://g.page/r/12345/review',
            label: 'Review 1',
            is_enabled: true,
          },
          {
            platform: 'google_reviews',
            destination_url: 'https://g.page/r/67890/review',
            label: 'Review 2',
            is_enabled: true,
          },
        ],
      })
      assert.match(multiErr, /allow at most 1 destination link/i)
    })

    it('enforces platform matching for instagram and whatsapp cards', () => {
      const instaErr = validateCreateCardForm({
        businessName: 'Style Studio',
        qrType: 'instagram',
        links: [
          {
            platform: 'whatsapp',
            destination_url: 'https://wa.me/1234567890',
            label: 'WhatsApp',
            is_enabled: true,
          },
        ],
      })
      assert.match(instaErr, /not permitted for Instagram cards/i)

      const waErr = validateCreateCardForm({
        businessName: 'Quick Help',
        qrType: 'whatsapp',
        links: [
          {
            platform: 'google_reviews',
            destination_url: 'https://g.page/r/12345/review',
            label: 'Google',
            is_enabled: true,
          },
        ],
      })
      assert.match(waErr, /not permitted for WhatsApp cards/i)
    })
  })

  describe('4. All-In-One Platform & Link Count Limits', () => {
    it('allows all_in_one cards to configure up to 20 links across all supported platforms', () => {
      const validLinks = [
        { platform: 'google_reviews', destination_url: 'https://g.page/r/test', label: 'Google', is_enabled: true },
        { platform: 'instagram', destination_url: 'https://instagram.com/test', label: 'Instagram', is_enabled: true },
        { platform: 'whatsapp', destination_url: 'https://wa.me/1234567890', label: 'WhatsApp', is_enabled: true },
        { platform: 'other', destination_url: 'https://mysite.com', label: 'Website', is_enabled: true },
      ]

      assert.strictEqual(
        validateCreateCardForm({
          businessName: 'All Stars Store',
          qrType: 'all_in_one',
          links: validLinks,
        }),
        null
      )
    })

    it('rejects all_in_one cards exceeding 20 destination links', () => {
      const tooManyLinks = Array.from({ length: 21 }, (_, i) => ({
        platform: 'other',
        destination_url: `https://example.com/link${i}`,
        label: `Link ${i}`,
        is_enabled: true,
      }))

      const err = validateCreateCardForm({
        businessName: 'Giant Store',
        qrType: 'all_in_one',
        links: tooManyLinks,
      })
      assert.match(err, /allow at most 20 destination link/i)
    })

    it('rejects duplicate URLs and duplicate single-platform types', () => {
      const dupUrlErr = validateCreateCardForm({
        businessName: 'Dup URL Store',
        qrType: 'all_in_one',
        links: [
          { platform: 'other', destination_url: 'https://example.com', label: 'Site 1', is_enabled: true },
          { platform: 'other', destination_url: 'https://example.com', label: 'Site 2', is_enabled: true },
        ],
      })
      assert.match(dupUrlErr, /Duplicate destination URL found/i)

      const dupPlatformErr = validateCreateCardForm({
        businessName: 'Dup Platform Store',
        qrType: 'all_in_one',
        links: [
          { platform: 'instagram', destination_url: 'https://instagram.com/page1', label: 'IG 1', is_enabled: true },
          { platform: 'instagram', destination_url: 'https://instagram.com/page2', label: 'IG 2', is_enabled: true },
        ],
      })
      assert.match(dupPlatformErr, /Only one "instagram" link is permitted/i)
    })
  })

  describe('5. Permanent QR Payload & Read-Only Scannability', () => {
    it('constructs canonical permanent redirect URL for preprinted cards with zero links', () => {
      const permanentToken = 'tst_tok_abc123'
      const prodEnv = { VITE_PUBLIC_REDIRECT_BASE_URL: 'https://tapme-ayd.pages.dev' }
      const redirectUrl = getPublicCardUrl(permanentToken, prodEnv)

      assert.strictEqual(redirectUrl, 'https://tapme-ayd.pages.dev/r/tst_tok_abc123')
      assert.ok(!redirectUrl.includes('workers.dev'))
      assert.ok(redirectUrl.includes('/r/tst_tok_abc123'))

      // Also verify default resolution ends with /r/:token
      const devUrl = getPublicCardUrl(permanentToken)
      assert.ok(devUrl.endsWith('/r/tst_tok_abc123'))
    })
  })

  describe('6. Configuration Modal Platform Restrictions & Staff Rules', () => {
    it('requires staff to provide at least one destination link when configuring an unconfigured card', () => {
      const staffEmptyErr = validateEditCardForm({
        businessName: 'Hardware Store',
        location: null,
        qrType: 'all_in_one',
        links: [],
        isMainAdmin: false,
        isConfigured: false,
      })
      assert.match(staffEmptyErr, /At least one destination link is required to configure this card/i)

      const staffValid = validateEditCardForm({
        businessName: 'Hardware Store',
        location: null,
        qrType: 'all_in_one',
        links: [
          {
            platform: 'whatsapp',
            destination_url: 'https://wa.me/9876543210',
            label: 'WhatsApp Chat',
            is_enabled: true,
          },
        ],
        isMainAdmin: false,
        isConfigured: false,
      })
      assert.strictEqual(staffValid, null)
    })

    it('forbids staff from editing an already-configured card', () => {
      const staffConfiguredErr = validateEditCardForm({
        businessName: 'Hardware Store',
        location: null,
        qrType: 'all_in_one',
        links: [
          {
            platform: 'whatsapp',
            destination_url: 'https://wa.me/9876543210',
            label: 'WhatsApp Chat',
            is_enabled: true,
          },
        ],
        isMainAdmin: false,
        isConfigured: true,
      })
      assert.match(staffConfiguredErr, /Staff members are not permitted to edit already-configured cards/i)
    })

    it('allows main admin to edit configured and unconfigured cards, including clearing links', () => {
      const adminEmpty = validateEditCardForm({
        businessName: 'Hardware Store Admin Edit',
        location: null,
        qrType: 'all_in_one',
        links: [],
        isMainAdmin: true,
        isConfigured: true,
      })
      assert.strictEqual(adminEmpty, null)

      const adminPayload = formatEditCardPayload({
        businessName: 'Hardware Store Admin Edit',
        location: null,
        links: [],
      })
      assert.strictEqual(adminPayload.business_name, 'Hardware Store Admin Edit')
      assert.strictEqual(adminPayload.links.length, 0)
      // Verify qr_type is never included in edit payload
      assert.strictEqual('qr_type' in adminPayload, false)
    })

    it('enforces single-purpose platform constraints during configuration', () => {
      const wrongPlatformErr = validateEditCardForm({
        businessName: 'Coffee Shop',
        location: null,
        qrType: 'whatsapp',
        links: [
          {
            platform: 'instagram',
            destination_url: 'https://instagram.com/coffeeshop',
            label: 'Instagram',
            is_enabled: true,
          },
        ],
        isMainAdmin: false,
        isConfigured: false,
      })
      assert.match(wrongPlatformErr, /not permitted for WhatsApp cards/i)

      const multiLinkErr = validateEditCardForm({
        businessName: 'Coffee Shop',
        location: null,
        qrType: 'whatsapp',
        links: [
          { platform: 'whatsapp', destination_url: 'https://wa.me/1111111111', label: 'WA 1', is_enabled: true },
          { platform: 'whatsapp', destination_url: 'https://wa.me/2222222222', label: 'WA 2', is_enabled: true },
        ],
        isMainAdmin: false,
        isConfigured: false,
      })
      assert.match(multiLinkErr, /allow at most 1 destination link/i)
    })
  })
})
