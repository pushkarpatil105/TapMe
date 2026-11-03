/**
 * Lightweight SVG logo assets for TapMe QR code centres.
 *
 * Each logo is self-contained with vector markup and a base64/URL-encoded data URI
 * suitable for immediate Canvas rendering (raster PNG) or direct SVG embedding (vector SVG).
 *
 * Strict isolation:
 * - No dependency on QR generation logic.
 * - Suitable for high-density rendering at small scales (24x24 to 128x128).
 */

function createDataUri(svgString) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
}

const GOOGLE_REVIEWS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
</svg>`

const INSTAGRAM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <defs>
    <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
      <stop offset="0%" stop-color="#fdf497"/>
      <stop offset="5%" stop-color="#fdf497"/>
      <stop offset="45%" stop-color="#fd5949"/>
      <stop offset="60%" stop-color="#d6249f"/>
      <stop offset="90%" stop-color="#285AEB"/>
    </radialGradient>
  </defs>
  <rect width="24" height="24" rx="6" fill="url(#ig-grad)"/>
  <path fill="#ffffff" d="M12 5.838c2.007 0 2.245.008 3.037.044.734.034 1.132.156 1.397.26.35.136.6.298.863.56.262.263.424.513.56.864.103.264.226.662.26 1.396.036.792.044 1.03.044 3.038s-.008 2.246-.044 3.038c-.034.734-.157 1.132-.26 1.396-.137.351-.299.601-.561.864-.263.262-.513.424-.864.56-.265.104-.663.226-1.397.26-.792.036-1.03.044-3.037.044s-2.246-.008-3.038-.044c-.734-.034-1.132-.156-1.396-.26-.352-.136-.602-.298-.865-.56-.262-.263-.424-.513-.56-.864-.104-.264-.226-.662-.26-1.396-.037-.792-.045-1.03-.045-3.038s.008-2.246.045-3.038c.034-.734.156-1.132.26-1.396.136-.351.298-.601.56-.864.263-.262.513-.424.865-.56.264-.104.662-.226 1.396-.26.792-.036 1.031-.044 3.038-.044zm0-1.838c-2.041 0-2.298.009-3.1.045-.8.037-1.348.164-1.826.35-.494.192-.913.449-1.33.867-.419.417-.675.836-.867 1.33-.186.478-.313 1.025-.35 1.826C4.491 9.202 4.482 9.459 4.482 11.5s.009 2.298.045 3.1c.037.8.164 1.348.35 1.826.192.494.448.913.867 1.33.417.418.836.675 1.33.867.478.186 1.026.313 1.826.35.802.036 1.059.045 3.1.045s2.298-.009 3.1-.045c.8-.037 1.348-.164 1.826-.35.494-.192.913-.449 1.33-.867.418-.417.675-.836.867-1.33.186-.478.313-1.026.35-1.826.036-.802.045-1.059.045-3.1s-.009-2.298-.045-3.1c-.037-.8-.164-1.348-.35-1.826-.192-.494-.449-.913-.867-1.33-.417-.418-.836-.675-1.33-.867-.478-.186-1.026-.313-1.826-.35-.802-.036-1.059-.045-3.1-.045z"/>
  <path fill="#ffffff" d="M12 7.618a4.382 4.382 0 1 0 0 8.764 4.382 4.382 0 0 0 0-8.764zm0 7.224a2.842 2.842 0 1 1 0-5.684 2.842 2.842 0 0 1 0 5.684zM16.554 6.946a1.024 1.024 0 1 0 0 2.048 1.024 1.024 0 0 0 0-2.048z"/>
</svg>`

const WHATSAPP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <circle cx="12" cy="12" r="12" fill="#25D366"/>
  <path fill="#ffffff" d="M17.5 14.3c-.3-.15-1.78-.88-2.06-.98-.28-.1-.48-.15-.68.15-.2.3-.78.98-.95 1.18-.18.2-.35.22-.65.08-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.53.15-.17.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.68-1.63-.93-2.24-.24-.59-.49-.51-.68-.52h-.58c-.2 0-.53.08-.8.38-.28.3-1.08 1.05-1.08 2.57s1.1 2.98 1.25 3.19c.15.2 2.17 3.32 5.27 4.65.74.32 1.31.51 1.76.65.74.24 1.41.2 1.95.12.6-.09 1.78-.73 2.03-1.43.25-.7.25-1.3.18-1.43-.08-.13-.28-.2-.58-.35z"/>
</svg>`

const WEBSITE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <circle cx="12" cy="12" r="11" fill="#0284c7"/>
  <path fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22zM1 12h22M12 1a17.2 17.2 0 0 1 4.5 11 17.2 17.2 0 0 1-4.5 11 17.2 17.2 0 0 1-4.5-11 17.2 17.2 0 0 1 4.5-11z"/>
</svg>`

const TAPME_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <defs>
    <linearGradient id="tapme-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="24" height="24" rx="6" fill="url(#tapme-grad)"/>
  <path fill="#ffffff" d="M12.8 3.5L5.5 13.2h5.2l-1.5 7.3 7.3-9.7h-5.2l1.5-7.3z"/>
</svg>`

export const QR_LOGOS = {
  google_reviews: {
    id: 'google_reviews',
    label: 'Google Reviews',
    color: '#ea4335',
    svg: GOOGLE_REVIEWS_SVG,
    dataUri: createDataUri(GOOGLE_REVIEWS_SVG),
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    color: '#e1306c',
    svg: INSTAGRAM_SVG,
    dataUri: createDataUri(INSTAGRAM_SVG),
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    color: '#25d366',
    svg: WHATSAPP_SVG,
    dataUri: createDataUri(WHATSAPP_SVG),
  },
  other: {
    id: 'other',
    label: 'Website / Other',
    color: '#0284c7',
    svg: WEBSITE_SVG,
    dataUri: createDataUri(WEBSITE_SVG),
  },
  tapme: {
    id: 'tapme',
    label: 'TapMe Multi-Link',
    color: '#8b5cf6',
    svg: TAPME_SVG,
    dataUri: createDataUri(TAPME_SVG),
  },
}

/**
 * Resolves the appropriate logo object for a specific platform.
 *
 * @param {string} platform
 * @returns {typeof QR_LOGOS[keyof typeof QR_LOGOS]}
 */
export function getQRLogoByPlatform(platform) {
  if (platform && platform in QR_LOGOS) {
    return QR_LOGOS[platform]
  }
  return QR_LOGOS.other
}

/**
 * Resolves the QR centre logo according to card destination rules:
 * - Exactly 1 enabled destination link: Use that platform's logo (Google, Instagram, WhatsApp, Other).
 * - Multiple enabled destination links (or 0): Use TapMe branding logo.
 *
 * @param {Array<Object>|{ links?: Array<Object> }} cardOrLinks - Either an array of links or a card object containing .links
 * @returns {typeof QR_LOGOS[keyof typeof QR_LOGOS]}
 */
export function getQRLogoForCard(cardOrLinks) {
  const rawLinks = Array.isArray(cardOrLinks)
    ? cardOrLinks
    : cardOrLinks?.links || []

  const enabledLinks = rawLinks.filter((l) => l && l.is_enabled !== false)

  if (enabledLinks.length === 1) {
    const platform = enabledLinks[0].platform
    return getQRLogoByPlatform(platform)
  }

  // 0 or 2+ enabled links -> TapMe branding
  return QR_LOGOS.tapme
}
