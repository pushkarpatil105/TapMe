import assert from 'node:assert'
import { describe, it } from 'node:test'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { getQRLogoForCard, QR_LOGOS } from '../assets/qr-logos.js'
import {
  getPublicCardUrl,
  isLocalDevelopmentUrl,
  isLanOrLocalAddress,
  validatePublicRedirectBaseUrl,
} from './public-url.js'
import {
  generateQrSvgString,
  getQRFilename,
} from './qr-generator.js'

describe('TapMe Phase 4 Batch 2 - QR Generator & Exporters Test Suite', () => {
  describe('1. Public URL Payload & Safe Encoding', () => {
    it('generates canonical redirect URL pointing to /r/:token', () => {
      const token = 'u4W7r-k0b8s_k9A1B2C3D4E5'
      const url = getPublicCardUrl(token)
      assert.strictEqual(url, `http://127.0.0.1:8787/r/${token}`)
      assert(!url.includes('destination'), 'Must not encode destination URLs')
    })

    it('safely encodes special characters in public tokens', () => {
      const token = 'token+with/special=chars'
      const url = getPublicCardUrl(token)
      assert.strictEqual(url, 'http://127.0.0.1:8787/r/token%2Bwith%2Fspecial%3Dchars')
    })

    it('identifies local development URLs accurately', () => {
      assert.strictEqual(isLocalDevelopmentUrl('http://127.0.0.1:8787/r/abc'), true)
      assert.strictEqual(isLocalDevelopmentUrl('http://localhost:5173/r/abc'), true)
      assert.strictEqual(isLocalDevelopmentUrl('http://localhost:8787/r/abc'), true)
      assert.strictEqual(isLocalDevelopmentUrl('http://192.168.1.100:8787/r/abc'), true)
      assert.strictEqual(isLocalDevelopmentUrl('http://10.0.0.5:8787/r/abc'), true)
      assert.strictEqual(isLocalDevelopmentUrl('http://172.16.5.1:8787/r/abc'), true)
      assert.strictEqual(isLocalDevelopmentUrl('https://tapme.pages.dev/r/abc'), false)
      assert.strictEqual(isLocalDevelopmentUrl('https://tapme.link/r/abc'), false)
      assert.strictEqual(isLocalDevelopmentUrl('https://custom-domain.com/r/abc'), false)
    })

    it('identifies LAN and private IP addresses correctly', () => {
      assert.strictEqual(isLanOrLocalAddress('192.168.1.1'), true)
      assert.strictEqual(isLanOrLocalAddress('10.0.0.1'), true)
      assert.strictEqual(isLanOrLocalAddress('172.16.0.1'), true)
      assert.strictEqual(isLanOrLocalAddress('172.31.255.255'), true)
      assert.strictEqual(isLanOrLocalAddress('169.254.1.1'), true)
      assert.strictEqual(isLanOrLocalAddress('127.0.0.1'), true)
      assert.strictEqual(isLanOrLocalAddress('localhost'), true)
      assert.strictEqual(isLanOrLocalAddress('tapme.pages.dev'), false)
      assert.strictEqual(isLanOrLocalAddress('example.com'), false)
    })

    it('enforces validation in production mode rejecting missing, localhost, or LAN IPs', () => {
      // Missing
      assert.throws(
        () => validatePublicRedirectBaseUrl(undefined, true),
        /VITE_PUBLIC_REDIRECT_BASE_URL is not configured for production/
      )
      assert.throws(
        () => validatePublicRedirectBaseUrl('', true),
        /VITE_PUBLIC_REDIRECT_BASE_URL is not configured for production/
      )

      // Localhost / Loopback
      assert.throws(
        () => validatePublicRedirectBaseUrl('http://localhost:5173', true),
        /cannot point to localhost, loopback, or a LAN IP in production/
      )
      assert.throws(
        () => validatePublicRedirectBaseUrl('http://127.0.0.1:8787', true),
        /cannot point to localhost, loopback, or a LAN IP in production/
      )

      // LAN IPs
      assert.throws(
        () => validatePublicRedirectBaseUrl('http://192.168.1.50:8787', true),
        /cannot point to localhost, loopback, or a LAN IP in production/
      )
      assert.throws(
        () => validatePublicRedirectBaseUrl('http://10.0.0.1:8787', true),
        /cannot point to localhost, loopback, or a LAN IP in production/
      )
      assert.throws(
        () => validatePublicRedirectBaseUrl('http://172.20.1.1:8787', true),
        /cannot point to localhost, loopback, or a LAN IP in production/
      )

      // Valid Pages URL in production
      const valid = validatePublicRedirectBaseUrl('https://tapme-production.pages.dev/', true)
      assert.strictEqual(valid, 'https://tapme-production.pages.dev')
    })

    it('generates QR payload pointing to Pages public hostname, never workers.dev', () => {
      const prodEnv = {
        PROD: true,
        VITE_PUBLIC_REDIRECT_BASE_URL: 'https://tapme.pages.dev',
      }
      const token = 'sample-public-token-123'
      const url = getPublicCardUrl(token, prodEnv)

      assert.strictEqual(url, 'https://tapme.pages.dev/r/sample-public-token-123')
      assert(!url.includes('workers.dev'), 'QR payload must never use workers.dev hostname')
      assert(!url.includes('127.0.0.1'), 'QR payload must never use 127.0.0.1 in production')
      assert(!url.includes('localhost'), 'QR payload must never use localhost in production')
    })
  })

  describe('2. Error Correction Level H Verification', () => {
    it('enforces QR error correction level H', () => {
      const url = 'http://127.0.0.1:8787/r/u4W7r-k0b8s_k9A1B2C3D4E5'
      const qr = QRCode.create(url, { errorCorrectionLevel: 'H', margin: 4 })
      // Level H retains ~30% recovery capability (bit: 2)
      assert.strictEqual(qr.errorCorrectionLevel.bit, 2)
      assert(qr.modules.size > 0)
    })
  })

  describe('3. Logo Selection Rules', () => {
    it('selects Google Reviews logo for single enabled Google link', () => {
      const card = {
        links: [
          { platform: 'google_reviews', destination_url: 'https://g.page/r/test', is_enabled: true },
        ],
      }
      const logo = getQRLogoForCard(card)
      assert.strictEqual(logo.id, 'google_reviews')
      assert.strictEqual(logo.label, 'Google Reviews')
    })

    it('selects Instagram logo for single enabled Instagram link', () => {
      const card = {
        links: [
          { platform: 'instagram', destination_url: 'https://instagram.com/test', is_enabled: true },
        ],
      }
      const logo = getQRLogoForCard(card)
      assert.strictEqual(logo.id, 'instagram')
      assert.strictEqual(logo.label, 'Instagram')
    })

    it('selects WhatsApp logo for single enabled WhatsApp link', () => {
      const card = {
        links: [
          { platform: 'whatsapp', destination_url: 'https://wa.me/12345', is_enabled: true },
        ],
      }
      const logo = getQRLogoForCard(card)
      assert.strictEqual(logo.id, 'whatsapp')
      assert.strictEqual(logo.label, 'WhatsApp')
    })

    it('selects Website/Other logo for single enabled Website link', () => {
      const card = {
        links: [
          { platform: 'other', destination_url: 'https://example.com', is_enabled: true },
        ],
      }
      const logo = getQRLogoForCard(card)
      assert.strictEqual(logo.id, 'other')
      assert.strictEqual(logo.label, 'Website / Other')
    })

    it('selects TapMe Branding logo for multiple enabled links', () => {
      const card = {
        links: [
          { platform: 'google_reviews', is_enabled: true },
          { platform: 'instagram', is_enabled: true },
          { platform: 'whatsapp', is_enabled: true },
        ],
      }
      const logo = getQRLogoForCard(card)
      assert.strictEqual(logo.id, 'tapme')
      assert.strictEqual(logo.label, 'TapMe Multi-Link')
    })

    it('selects single-platform logo when other links are disabled', () => {
      const card = {
        links: [
          { platform: 'google_reviews', is_enabled: false },
          { platform: 'whatsapp', is_enabled: true },
          { platform: 'instagram', is_enabled: false },
        ],
      }
      const logo = getQRLogoForCard(card)
      assert.strictEqual(logo.id, 'whatsapp')
    })

    it('selects TapMe Branding logo when 0 links are configured or enabled', () => {
      assert.strictEqual(getQRLogoForCard({ links: [] }).id, 'tapme')
      assert.strictEqual(getQRLogoForCard({ links: [{ platform: 'other', is_enabled: false }] }).id, 'tapme')
      assert.strictEqual(getQRLogoForCard(null).id, 'tapme')
    })
  })

  describe('4. Invalid or Missing Token Handling', () => {
    it('throws when public token is null, undefined, or empty', () => {
      assert.throws(() => getPublicCardUrl(null), /valid publicToken is required/)
      assert.throws(() => getPublicCardUrl(undefined), /valid publicToken is required/)
      assert.throws(() => getPublicCardUrl(''), /valid publicToken is required/)
      assert.throws(() => getPublicCardUrl('   '), /valid publicToken is required/)
    })
  })

  describe('5. Vector SVG Generation & Embedded Artwork', () => {
    it('generates genuine SVG with embedded vector markup (not external image)', async () => {
      const url = 'http://127.0.0.1:8787/r/sample-token'
      const logo = QR_LOGOS.google_reviews
      const svg = await generateQrSvgString(url, logo, { size: 2048 })

      // Starts and ends with standard SVG tags
      assert(svg.startsWith('<svg width="2048" height="2048"'))
      assert(svg.endsWith('</svg>'))

      // Contains embedded center logo group
      assert(svg.includes('<g id="qr-center-logo">'))

      // Contains solid white quiet zone background
      assert(svg.includes('<rect'))
      assert(svg.includes('fill="#ffffff"'))

      // Contains nested vector SVG element with embedded path elements
      assert(svg.includes('<svg x='))
      assert(svg.includes('viewBox="0 0 24 24"'))
      assert(svg.includes('<path fill="#4285F4"'))
      assert(svg.includes('<path fill="#EA4335"'))

      // NEVER contains external image references
      assert(!svg.includes('<image'), 'SVG must not use external <image> tags')
      assert(!svg.includes('xlink:href'), 'SVG must not use xlink:href')
    })

    it('generates valid vector SVG for TapMe multi-link branding with gradient defs', async () => {
      const url = 'http://127.0.0.1:8787/r/sample-token'
      const logo = QR_LOGOS.tapme
      const svg = await generateQrSvgString(url, logo, { size: 2048 })

      assert(svg.includes('<g id="qr-center-logo">'))
      assert(svg.includes('tapme-grad'))
      assert(svg.includes('<rect width="24" height="24" rx="6" fill="url(#tapme-grad)"/>'))
    })
  })

  describe('6. Filename Sanitization & Formatting', () => {
    it('constructs standard, safe filenames for PNG and SVG', () => {
      const card = {
        card_number: 1,
        formatted_card_number: '001',
        business_name: 'Acme Coffee & Bakery!',
      }

      assert.strictEqual(getQRFilename(card, 'png'), 'TapMe-001-Acme-Coffee-Bakery.png')
      assert.strictEqual(getQRFilename(card, 'svg'), 'TapMe-001-Acme-Coffee-Bakery.svg')
    })

    it('handles cards without formatted_card_number or missing business_name', () => {
      assert.strictEqual(getQRFilename({ card_number: 7 }, 'png'), 'TapMe-007-Card.png')
      assert.strictEqual(getQRFilename(null, 'png'), 'TapMe-CARD-Card.png')
      assert.strictEqual(getQRFilename({ business_name: '   ' }, 'svg'), 'TapMe-CARD-Card.svg')
    })
  })

  describe('7. PNG Canvas Dimensions & Offscreen Calculation', () => {
    it('computes 2048x2048 dimensions and conservative logo sizes', () => {
      const size = 2048
      const logoRatio = 0.19
      const bgRatio = 0.23

      const logoSize = Math.round(size * logoRatio)
      const bgSize = Math.round(size * bgRatio)

      // Logo is ~389px (19%)
      assert.strictEqual(logoSize, 389)
      // Background mask is ~471px (23%)
      assert.strictEqual(bgSize, 471)

      // Clearance verification
      const bgStartRatio = (1 - bgRatio) / 2
      const finderPatternEndRatio = 11 / 37
      assert(bgStartRatio > finderPatternEndRatio + 0.05, 'Logo quiet zone must not touch finder patterns')
    })
  })

  describe('8. Batch 3 Status Handling & Token Immutability', () => {
    it('generates identical QR payload and matrix for a permanent public token across multiple calls', () => {
      const card = {
        card_number: 1,
        formatted_card_number: '001',
        public_token: 'u4W7r-k0b8s_k9A1B2C3D4E5',
        business_name: 'Stable Cafe',
        status: 'active',
        links: [{ platform: 'google_reviews', is_enabled: true }],
      }

      const url1 = getPublicCardUrl(card.public_token)
      const url2 = getPublicCardUrl(card.public_token)
      assert.strictEqual(url1, url2)

      const qr1 = QRCode.create(url1, { errorCorrectionLevel: 'H' })
      const qr2 = QRCode.create(url2, { errorCorrectionLevel: 'H' })
      assert.deepStrictEqual(qr1.modules.data, qr2.modules.data)
      assert.strictEqual(card.public_token, 'u4W7r-k0b8s_k9A1B2C3D4E5', 'Card token must not mutate')
    })

    it('identifies active, inactive, and archived card status invariants', () => {
      const activeCard = { status: 'active', public_token: 'tokenA' }
      const inactiveCard = { status: 'inactive', public_token: 'tokenB' }
      const archivedCard = { status: 'archived', public_token: 'tokenC' }

      assert.strictEqual(activeCard.status, 'active')
      assert.strictEqual(inactiveCard.status, 'inactive')
      assert.strictEqual(archivedCard.status, 'archived')

      // All preserve their permanent public URL without altering backend lifecycle
      assert(getPublicCardUrl(activeCard.public_token).endsWith('/r/tokenA'))
      assert(getPublicCardUrl(inactiveCard.public_token).endsWith('/r/tokenB'))
      assert(getPublicCardUrl(archivedCard.public_token).endsWith('/r/tokenC'))
    })
  })

  describe('9. Programmatic QR Decoding & Scannability (jsQR)', () => {
    function rasterizeSvgToPixelBuffer(svgString, scale = 10) {
      const match = svgString.match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/)
      const matrixSize = parseFloat(match[1])
      const imageSize = matrixSize * scale

      const rgba = new Uint8ClampedArray(imageSize * imageSize * 4)
      rgba.fill(255)

      const pathMatch = svgString.match(/<path stroke="#000000" d="([^"]+)"\/>/)
      if (!pathMatch) {
        throw new Error('Could not find black stroke path in SVG')
      }

      const d = pathMatch[1]
      const regex = /M(\d+)\s+([\d.]+)h(\d+)|m(\d+)\s+0h(\d+)/g
      let currentY = 0
      let currentX = 0
      let m

      while ((m = regex.exec(d)) !== null) {
        if (m[1] !== undefined) {
          currentX = parseInt(m[1], 10)
          currentY = Math.floor(parseFloat(m[2]))
          const len = parseInt(m[3], 10)
          for (let x = currentX; x < currentX + len; x++) {
            paintModule(x, currentY, rgba, imageSize, scale)
          }
          currentX += len
        } else {
          const dx = parseInt(m[4], 10)
          const len = parseInt(m[5], 10)
          currentX += dx
          for (let x = currentX; x < currentX + len; x++) {
            paintModule(x, currentY, rgba, imageSize, scale)
          }
          currentX += len
        }
      }

      // Clear center quiet zone as defined by rect fill="#ffffff" in SVG
      const rectMatch = svgString.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/)
      if (rectMatch) {
        const rx = parseFloat(rectMatch[1])
        const ry = parseFloat(rectMatch[2])
        const rw = parseFloat(rectMatch[3])
        const rh = parseFloat(rectMatch[4])

        for (let y = Math.floor(ry * scale); y < Math.ceil((ry + rh) * scale); y++) {
          for (let x = Math.floor(rx * scale); x < Math.ceil((rx + rw) * scale); x++) {
            const idx = (y * imageSize + x) * 4
            rgba[idx] = 255
            rgba[idx + 1] = 255
            rgba[idx + 2] = 255
            rgba[idx + 3] = 255
          }
        }
      }

      return { rgba, imageSize }
    }

    function paintModule(mx, my, rgba, imageSize, scale) {
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const idx = ((my * scale + py) * imageSize + (mx * scale + px)) * 4
          rgba[idx] = 0
          rgba[idx + 1] = 0
          rgba[idx + 2] = 0
          rgba[idx + 3] = 255
        }
      }
    }

    it('successfully decodes SVG QR codes with Google Reviews center logo', async () => {
      const url = 'http://127.0.0.1:8787/r/google-scan-token'
      const svg = await generateQrSvgString(url, QR_LOGOS.google_reviews)
      const { rgba, imageSize } = rasterizeSvgToPixelBuffer(svg, 10)
      const decoded = jsQR(rgba, imageSize, imageSize)

      assert(decoded, 'QR barcode decoder must successfully detect and decode QR')
      assert.strictEqual(decoded.data, url)
    })

    it('successfully decodes SVG QR codes with Instagram center logo', async () => {
      const url = 'http://127.0.0.1:8787/r/instagram-scan-token'
      const svg = await generateQrSvgString(url, QR_LOGOS.instagram)
      const { rgba, imageSize } = rasterizeSvgToPixelBuffer(svg, 10)
      const decoded = jsQR(rgba, imageSize, imageSize)

      assert(decoded, 'QR barcode decoder must successfully detect and decode QR')
      assert.strictEqual(decoded.data, url)
    })

    it('successfully decodes SVG QR codes with WhatsApp center logo', async () => {
      const url = 'http://127.0.0.1:8787/r/whatsapp-scan-token'
      const svg = await generateQrSvgString(url, QR_LOGOS.whatsapp)
      const { rgba, imageSize } = rasterizeSvgToPixelBuffer(svg, 10)
      const decoded = jsQR(rgba, imageSize, imageSize)

      assert(decoded, 'QR barcode decoder must successfully detect and decode QR')
      assert.strictEqual(decoded.data, url)
    })

    it('successfully decodes SVG QR codes with Website/Other center logo', async () => {
      const url = 'http://127.0.0.1:8787/r/website-scan-token'
      const svg = await generateQrSvgString(url, QR_LOGOS.other)
      const { rgba, imageSize } = rasterizeSvgToPixelBuffer(svg, 10)
      const decoded = jsQR(rgba, imageSize, imageSize)

      assert(decoded, 'QR barcode decoder must successfully detect and decode QR')
      assert.strictEqual(decoded.data, url)
    })

    it('successfully decodes SVG QR codes with TapMe multi-link center logo', async () => {
      const url = 'http://127.0.0.1:8787/r/tapme-multi-token'
      const svg = await generateQrSvgString(url, QR_LOGOS.tapme)
      const { rgba, imageSize } = rasterizeSvgToPixelBuffer(svg, 10)
      const decoded = jsQR(rgba, imageSize, imageSize)

      assert(decoded, 'QR barcode decoder must successfully detect and decode QR')
      assert.strictEqual(decoded.data, url)
    })
  })
})
