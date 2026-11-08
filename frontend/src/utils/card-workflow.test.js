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
  CARD_TYPE_FILTER_OPTIONS,
  getCardTypeBadge,
  matchesCardType,
  filterCards,
  sortCards,
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

  describe('7. Card Inventory Search & Sorting Utilities (Stage B)', () => {
    const sampleCards = [
      {
        card_number: 1,
        formatted_card_number: '#001',
        business_name: 'Zeta Technologies',
        location: 'Mumbai Central',
        created_at: '2026-01-10T10:00:00Z',
        status: 'active',
        public_token: 'tk_zeta_001',
      },
      {
        card_number: 2,
        formatted_card_number: '#002',
        business_name: 'Acme Cafe',
        location: 'Pune South',
        created_at: '2026-02-15T12:00:00Z',
        status: 'active',
        public_token: 'tk_acme_002',
      },
      {
        card_number: 10,
        formatted_card_number: '#010',
        business_name: 'Beta Logistics',
        location: null,
        created_at: '2026-03-20T14:00:00Z',
        status: 'inactive',
        public_token: 'tk_beta_010',
      },
    ]

    describe('Search Filtering', () => {
      it('returns all cards when search query is empty or whitespace', () => {
        assert.strictEqual(filterCards(sampleCards, '').length, 3)
        assert.strictEqual(filterCards(sampleCards, '   ').length, 3)
        assert.strictEqual(filterCards(sampleCards, null).length, 3)
      })

      it('filters by business name with partial and case-insensitive matching', () => {
        const res = filterCards(sampleCards, 'acme')
        assert.strictEqual(res.length, 1)
        assert.strictEqual(res[0].business_name, 'Acme Cafe')

        const res2 = filterCards(sampleCards, 'TA')
        assert.strictEqual(res2.length, 2) // Zeta and Beta
      })

      it('filters by location with partial and case-insensitive matching and handles null locations', () => {
        const res = filterCards(sampleCards, 'mumbai')
        assert.strictEqual(res.length, 1)
        assert.strictEqual(res[0].card_number, 1)

        const resSouth = filterCards(sampleCards, 'SOUTH')
        assert.strictEqual(resSouth.length, 1)
        assert.strictEqual(resSouth[0].card_number, 2)
      })

      it('filters by card number with numeric or formatted hash search', () => {
        const resNum = filterCards(sampleCards, '10')
        assert.strictEqual(resNum.length, 1)
        assert.strictEqual(resNum[0].card_number, 10)

        const resHash = filterCards(sampleCards, '#002')
        assert.strictEqual(resHash.length, 1)
        assert.strictEqual(resHash[0].card_number, 2)
      })

      it('returns empty array when no records match', () => {
        const res = filterCards(sampleCards, 'Nonexistent Query 999')
        assert.strictEqual(res.length, 0)
      })

      it('does not mutate the source array', () => {
        const originalCopy = JSON.stringify(sampleCards)
        filterCards(sampleCards, 'acme')
        assert.strictEqual(JSON.stringify(sampleCards), originalCopy)
      })
    })

    describe('Sorting', () => {
      it('sorts by created_desc (default: newest first)', () => {
        const sorted = sortCards(sampleCards, 'created_desc')
        assert.strictEqual(sorted[0].card_number, 10) // Mar 2026
        assert.strictEqual(sorted[1].card_number, 2)  // Feb 2026
        assert.strictEqual(sorted[2].card_number, 1)  // Jan 2026
      })

      it('sorts by created_asc (oldest first)', () => {
        const sorted = sortCards(sampleCards, 'created_asc')
        assert.strictEqual(sorted[0].card_number, 1)
        assert.strictEqual(sorted[1].card_number, 2)
        assert.strictEqual(sorted[2].card_number, 10)
      })

      it('sorts by name_asc and name_desc alphabetically', () => {
        const asc = sortCards(sampleCards, 'name_asc')
        assert.strictEqual(asc[0].business_name, 'Acme Cafe')
        assert.strictEqual(asc[1].business_name, 'Beta Logistics')
        assert.strictEqual(asc[2].business_name, 'Zeta Technologies')

        const desc = sortCards(sampleCards, 'name_desc')
        assert.strictEqual(desc[0].business_name, 'Zeta Technologies')
        assert.strictEqual(desc[1].business_name, 'Beta Logistics')
        assert.strictEqual(desc[2].business_name, 'Acme Cafe')
      })

      it('sorts card numbers numerically, not lexicographically (1, 2, 10)', () => {
        const numAsc = sortCards(sampleCards, 'number_asc')
        assert.deepStrictEqual(numAsc.map((c) => c.card_number), [1, 2, 10])

        const numDesc = sortCards(sampleCards, 'number_desc')
        assert.deepStrictEqual(numDesc.map((c) => c.card_number), [10, 2, 1])
      })

      it('works seamlessly in combination: search then sort', () => {
        const filtered = filterCards(sampleCards, 'ta')
        const sorted = sortCards(filtered, 'name_asc')
        assert.strictEqual(sorted.length, 2)
        assert.strictEqual(sorted[0].business_name, 'Beta Logistics')
        assert.strictEqual(sorted[1].business_name, 'Zeta Technologies')
      })

      it('does not mutate original array during sorting', () => {
        const originalOrder = sampleCards.map((c) => c.card_number)
        sortCards(sampleCards, 'number_desc')
        assert.deepStrictEqual(sampleCards.map((c) => c.card_number), originalOrder)
      })
    })
  })

  describe('8. Card Type Badges & Multi-Factor Filtering (Stage B.1)', () => {
    const inventoryCards = [
      {
        card_number: 101,
        formatted_card_number: '#101',
        business_name: 'Sunset Cafe',
        location: 'Mumbai Bandra',
        qr_type: 'instagram',
        links: [{ platform: 'instagram', destination_url: 'https://instagram.com/sunsetcafe' }],
      },
      {
        card_number: 102,
        formatted_card_number: '#102',
        business_name: 'Metro Dental Clinic',
        location: 'Pune Camp',
        qr_type: 'google_review',
        links: [{ platform: 'google_reviews', destination_url: 'https://g.page/r/metrodental' }],
      },
      {
        card_number: 103,
        formatted_card_number: '#103',
        business_name: 'Quick Support Hotline',
        location: null,
        qr_type: 'whatsapp',
        links: [{ platform: 'whatsapp', destination_url: 'https://wa.me/919876543210' }],
      },
      {
        card_number: 104,
        formatted_card_number: '#104',
        business_name: 'Apex Global Enterprises',
        location: 'Bengaluru Tech Park',
        qr_type: 'all_in_one',
        links: [
          { platform: 'google_reviews', destination_url: 'https://g.page/r/apex' },
          { platform: 'instagram', destination_url: 'https://instagram.com/apex' },
          { platform: 'whatsapp', destination_url: 'https://wa.me/919999999999' },
        ],
      },
      {
        card_number: 105,
        formatted_card_number: '#105',
        business_name: 'Unconfigured Multi Card',
        location: 'Delhi Connaught Place',
        qr_type: 'all_in_one',
        links: [],
      },
    ]

    describe('getCardTypeBadge', () => {
      it('resolves Instagram badge accurately from qr_type', () => {
        const badge = getCardTypeBadge(inventoryCards[0])
        assert.strictEqual(badge.type, 'instagram')
        assert.strictEqual(badge.label, 'Instagram')
        assert.strictEqual(badge.badgeClass, 'card-type-instagram')
      })

      it('resolves Google Reviews badge accurately from qr_type', () => {
        const badge = getCardTypeBadge(inventoryCards[1])
        assert.strictEqual(badge.type, 'google_review')
        assert.strictEqual(badge.label, 'Google Reviews')
        assert.strictEqual(badge.badgeClass, 'card-type-googlereviews')
      })

      it('resolves WhatsApp badge accurately from qr_type', () => {
        const badge = getCardTypeBadge(inventoryCards[2])
        assert.strictEqual(badge.type, 'whatsapp')
        assert.strictEqual(badge.label, 'WhatsApp')
        assert.strictEqual(badge.badgeClass, 'card-type-whatsapp')
      })

      it('resolves Multi-link badge for all_in_one and multi-destination cards', () => {
        const badgeConfigured = getCardTypeBadge(inventoryCards[3])
        assert.strictEqual(badgeConfigured.type, 'all_in_one')
        assert.strictEqual(badgeConfigured.label, 'Multi-link')
        assert.strictEqual(badgeConfigured.badgeClass, 'card-type-multilink')

        const badgeUnconfigured = getCardTypeBadge(inventoryCards[4])
        assert.strictEqual(badgeUnconfigured.type, 'all_in_one')
        assert.strictEqual(badgeUnconfigured.label, 'Multi-link')
      })

      it('does not infer type from business name', () => {
        // Business name has "Instagram" in it, but qr_type is whatsapp
        const spoofedCard = {
          business_name: 'Instagram Marketing Agency',
          qr_type: 'whatsapp',
          links: [{ platform: 'whatsapp', destination_url: 'https://wa.me/12345' }],
        }
        const badge = getCardTypeBadge(spoofedCard)
        assert.strictEqual(badge.type, 'whatsapp')
        assert.strictEqual(badge.label, 'WhatsApp')
      })

      it('safely handles missing or null card inputs', () => {
        const badge = getCardTypeBadge(null)
        assert.strictEqual(badge.type, 'unknown')
        assert.strictEqual(badge.label, 'Card')
        assert.strictEqual(badge.badgeClass, 'card-type-default')
      })
    })

    describe('CARD_TYPE_FILTER_OPTIONS', () => {
      it('provides the standard filter options required by Stage B.1', () => {
        const values = CARD_TYPE_FILTER_OPTIONS.map((opt) => opt.value)
        const labels = CARD_TYPE_FILTER_OPTIONS.map((opt) => opt.label)
        assert.deepStrictEqual(values, ['', 'instagram', 'google_review', 'whatsapp', 'all_in_one'])
        assert.deepStrictEqual(labels, ['All Cards', 'Instagram', 'Google Reviews', 'WhatsApp', 'Multi-link'])
      })
    })

    describe('matchesCardType and Multi-Factor filterCards', () => {
      it('matches all cards when filter is empty or all', () => {
        assert.strictEqual(matchesCardType(inventoryCards[0], ''), true)
        assert.strictEqual(matchesCardType(inventoryCards[0], 'all'), true)
        assert.strictEqual(filterCards(inventoryCards, '', '').length, 5)
        assert.strictEqual(filterCards(inventoryCards, '', 'all').length, 5)
      })

      it('evaluates matchesCardType correctly for individual card types', () => {
        assert.strictEqual(matchesCardType(inventoryCards[0], 'instagram'), true)
        assert.strictEqual(matchesCardType(inventoryCards[0], 'google_review'), false)
        assert.strictEqual(matchesCardType(inventoryCards[1], 'google_review'), true)
        assert.strictEqual(matchesCardType(inventoryCards[2], 'whatsapp'), true)
        assert.strictEqual(matchesCardType(inventoryCards[3], 'all_in_one'), true)
        assert.strictEqual(matchesCardType(null, 'instagram'), false)
      })

      it('filters cards by Instagram type', () => {
        const result = filterCards(inventoryCards, '', 'instagram')
        // Card 101 has qr_type instagram; Card 104 has an instagram link
        const cardNumbers = result.map((c) => c.card_number)
        assert.ok(cardNumbers.includes(101))
        assert.ok(cardNumbers.includes(104))
        assert.ok(!cardNumbers.includes(102))
        assert.ok(!cardNumbers.includes(103))
      })

      it('filters cards by Google Reviews type', () => {
        const result = filterCards(inventoryCards, '', 'google_review')
        const cardNumbers = result.map((c) => c.card_number)
        assert.ok(cardNumbers.includes(102))
        assert.ok(cardNumbers.includes(104))
        assert.ok(!cardNumbers.includes(101))
      })

      it('filters cards by WhatsApp type', () => {
        const result = filterCards(inventoryCards, '', 'whatsapp')
        const cardNumbers = result.map((c) => c.card_number)
        assert.ok(cardNumbers.includes(103))
        assert.ok(cardNumbers.includes(104))
        assert.ok(!cardNumbers.includes(101))
      })

      it('filters cards by Multi-link type', () => {
        const result = filterCards(inventoryCards, '', 'all_in_one')
        const cardNumbers = result.map((c) => c.card_number)
        assert.deepStrictEqual(cardNumbers, [104, 105])
      })

      it('combines text search with card type filter (AND conjunction)', () => {
        // Search 'Sunset' + type 'instagram' -> Card 101
        const res1 = filterCards(inventoryCards, 'Sunset', 'instagram')
        assert.strictEqual(res1.length, 1)
        assert.strictEqual(res1[0].card_number, 101)

        // Search 'Sunset' + type 'google_review' -> 0 matches
        const res2 = filterCards(inventoryCards, 'Sunset', 'google_review')
        assert.strictEqual(res2.length, 0)

        // Search by location 'Tech Park' + type 'all_in_one' -> Card 104
        const res3 = filterCards(inventoryCards, 'Tech Park', 'all_in_one')
        assert.strictEqual(res3.length, 1)
        assert.strictEqual(res3[0].card_number, 104)
      })

      it('preserves other filter criteria when sort order changes', () => {
        const filtered = filterCards(inventoryCards, 'clinic', 'google_review')
        assert.strictEqual(filtered.length, 1)
        const sortedDesc = sortCards(filtered, 'name_desc')
        assert.strictEqual(sortedDesc[0].business_name, 'Metro Dental Clinic')
      })
    })
  })
})
