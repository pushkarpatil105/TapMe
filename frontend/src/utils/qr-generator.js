import QRCode from 'qrcode'

/**
 * Constructs a sanitized, readable filename for card exports.
 * E.g., "TapMe-001-Example-Business.png"
 *
 * @param {Object} card
 * @param {'png'|'svg'} [extension='png']
 * @returns {string}
 */
export function getQRFilename(card, extension = 'png') {
  const num = card?.formatted_card_number ||
    (card?.card_number != null ? String(card.card_number).padStart(3, '0') : 'CARD')
  const cleanName = (card?.business_name || 'Card')
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return `TapMe-${num}-${cleanName || 'Card'}.${extension.toLowerCase()}`
}

/**
 * Draws a high-resolution QR code onto an HTML5 canvas with a centered logo
 * and a padded solid white background behind the logo.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} payloadUrl - The public redirect URL to encode
 * @param {Object} logo - The logo definition from qr-logos.js
 * @param {Object} [options]
 * @param {number} [options.size=2048] - Dimension in pixels (width & height)
 * @param {number} [options.margin=4] - QR quiet zone in modules
 * @param {number} [options.logoRatio=0.19] - Logo dimension relative to QR width (18-20%)
 * @param {number} [options.bgRatio=0.23] - Quiet zone background relative to QR width
 * @returns {Promise<void>}
 */
export async function renderQrToCanvas(canvas, payloadUrl, logo, options = {}) {
  const {
    size = 2048,
    margin = 4,
    logoRatio = 0.19,
    bgRatio = 0.23,
  } = options

  if (!canvas) {
    throw new Error('Canvas element is required for QR rendering.')
  }
  if (!payloadUrl || typeof payloadUrl !== 'string') {
    throw new Error('Valid payload URL is required for QR rendering.')
  }

  canvas.width = size
  canvas.height = size

  // 1. Render base QR code onto canvas
  await QRCode.toCanvas(canvas, payloadUrl, {
    width: size,
    margin,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  })

  // If no logo is specified (e.g., all_in_one has no logo), standard clean QR is complete.
  // Strictly avoid drawing any center white mask, quiet zone, or placeholder.
  if (!logo || !logo.dataUri) {
    return
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context is not available.')
  }

  // 2. Compute center positions
  const center = size / 2
  const logoSize = Math.round(size * logoRatio)
  const bgSize = Math.round(size * bgRatio)
  const bgRadius = Math.round(bgSize * 0.16)

  const logoOffset = Math.round(center - logoSize / 2)
  const bgOffset = Math.round(center - bgSize / 2)

  // 3. Draw solid white background mask (quiet zone for center logo)
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bgOffset, bgOffset, bgSize, bgSize, bgRadius)
  } else {
    // Fallback arcTo for environments without ctx.roundRect
    const r = bgRadius, x = bgOffset, y = bgOffset, w = bgSize, h = bgSize
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
  ctx.fill()

  // 4. Draw the vector logo image
  if (logo && logo.dataUri) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = (e) => reject(new Error('Failed to load center logo image: ' + (e?.message || 'unknown error')))
      img.src = logo.dataUri
    })
    ctx.drawImage(img, logoOffset, logoOffset, logoSize, logoSize)
  }

  ctx.restore()
}

/**
 * Generates an authentic, crisp 2048 x 2048 PNG Blob.
 *
 * @param {string} payloadUrl
 * @param {Object} logo
 * @returns {Promise<Blob>}
 */
export async function generateHighResPngBlob(payloadUrl, logo) {
  const exportCanvas = document.createElement('canvas')
  await renderQrToCanvas(exportCanvas, payloadUrl, logo, { size: 2048, margin: 4 })

  return new Promise((resolve, reject) => {
    exportCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Failed to export canvas as PNG blob.'))
      }
    }, 'image/png')
  })
}

/**
 * Generates a genuine, standalone vector SVG QR code with embedded center logo.
 * Does not use external image references; embeds the vector markup directly.
 *
 * @param {string} payloadUrl
 * @param {Object} logo
 * @param {Object} [options]
 * @param {number} [options.size=2048] - Target canvas dimension for width/height attributes
 * @param {number} [options.margin=4] - Quiet zone in modules
 * @param {number} [options.logoRatio=0.19]
 * @param {number} [options.bgRatio=0.23]
 * @returns {Promise<string>} Standalone XML SVG string
 */
export async function generateQrSvgString(payloadUrl, logo, options = {}) {
  const {
    size = 2048,
    margin = 4,
    logoRatio = 0.19,
    bgRatio = 0.23,
  } = options

  if (!payloadUrl || typeof payloadUrl !== 'string') {
    throw new Error('Valid payload URL is required for QR SVG generation.')
  }

  // 1. Generate base SVG with Level H
  let rawSvg = await QRCode.toString(payloadUrl, {
    type: 'svg',
    margin,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#ffffff' },
  })

  // Ensure explicit root dimensions for vector print software
  if (!rawSvg.startsWith('<svg width=')) {
    rawSvg = rawSvg.replace('<svg ', `<svg width="${size}" height="${size}" `)
  }

  // If no logo is specified (e.g., all_in_one), return clean standard QR SVG directly
  // with no qr-center-logo group, no white rectangle, and no placeholder.
  if (!logo || !logo.svg) {
    return rawSvg.trim()
  }

  // 2. Extract viewBox dimensions
  const viewBoxMatch = rawSvg.match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/)
  if (!viewBoxMatch) {
    throw new Error('Unable to extract viewBox from generated QR SVG.')
  }

  const matrixSize = parseFloat(viewBoxMatch[1])
  const center = matrixSize / 2
  const logoSize = +(matrixSize * logoRatio).toFixed(3)
  const bgSize = +(matrixSize * bgRatio).toFixed(3)
  const logoOffset = +(center - logoSize / 2).toFixed(3)
  const bgOffset = +(center - bgSize / 2).toFixed(3)
  const bgRadius = +(bgSize * 0.16).toFixed(3)

  // 3. Extract the inner artwork of the logo SVG
  const innerLogoXml = logo.svg
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
    .trim()

  const logoGroup = `
  <g id="qr-center-logo">
    <rect x="${bgOffset}" y="${bgOffset}" width="${bgSize}" height="${bgSize}" rx="${bgRadius}" fill="#ffffff" shape-rendering="geometricPrecision"/>
    <svg x="${logoOffset}" y="${logoOffset}" width="${logoSize}" height="${logoSize}" viewBox="0 0 24 24" shape-rendering="geometricPrecision">
      ${innerLogoXml}
    </svg>
  </g>
</svg>`

  const finalSvg = rawSvg.replace('</svg>', logoGroup)
  return finalSvg.trim()
}

/**
 * Triggers a browser download for a Blob or text content.
 *
 * @param {Blob|string} content
 * @param {string} filename
 * @param {string} [mimeType='application/octet-stream']
 */
export function triggerFileDownload(content, filename, mimeType = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
