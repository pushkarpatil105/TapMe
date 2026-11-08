/**
 * Centralized public redirect URL resolution for TapMe cards.
 *
 * Enforces strict environment boundaries:
 * - Uses `VITE_PUBLIC_REDIRECT_BASE_URL` when provided.
 * - Defaults to the canonical TapMe public redirect domain (https://tapme-ayd.pages.dev).
 * - Refuses silent localhost, loopback, or LAN IP fallbacks in production, requiring explicit public domain configuration.
 * - Ensures URLs are formatted with standard HTTP/HTTPS protocols and trimmed of trailing slashes.
 */

export const CANONICAL_PUBLIC_REDIRECT_BASE_URL = 'https://tapme-ayd.pages.dev';

/**
 * Checks whether a hostname corresponds to a local, loopback, or LAN private IP address.
 * Covers RFC 1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), loopback (127.0.0.0/8),
 * link-local (169.254.0.0/16), CGNAT (100.64.0.0/10), and localhost names.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLanOrLocalAddress(hostname) {
  const host = (hostname || '').toLowerCase().trim();
  if (!host) return false;

  // Localhost, any-address, loopback
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  // IPv4 Loopback 127.0.0.0/8
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) {
    return true;
  }

  // RFC 1918 Private Class A: 10.0.0.0/8
  if (/^10(?:\.\d{1,3}){3}$/.test(host)) {
    return true;
  }

  // RFC 1918 Private Class B: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (/^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host)) {
    return true;
  }

  // RFC 1918 Private Class C: 192.168.0.0/16
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(host)) {
    return true;
  }

  // Link-local / APIPA: 169.254.0.0/16
  if (/^169\.254(?:\.\d{1,3}){2}$/.test(host)) {
    return true;
  }

  // Carrier-grade NAT: 100.64.0.0/10
  if (/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/.test(host)) {
    return true;
  }

  // IPv6 Unique Local (fc00::/7) or Link-Local (fe80::/10)
  if (/^(?:fe[89ab]|fc|fd)[0-9a-f]{2}:/i.test(host)) {
    return true;
  }

  return false;
}

/**
 * Validates the public redirect base URL string.
 *
 * @param {unknown} configured - The raw URL string from environment.
 * @param {boolean} [isProd=false] - Whether validating in production mode.
 * @returns {string | null} Clean URL string without trailing slash, or null if unset in development.
 * @throws {Error} If invalid format, protocol, or if pointing to localhost/LAN IP in production.
 */
export function validatePublicRedirectBaseUrl(configured, isProd = false) {
  if (configured && typeof configured === 'string' && configured.trim()) {
    const trimmed = configured.trim();
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error(
        `[TapMe Config Error] Invalid VITE_PUBLIC_REDIRECT_BASE_URL: "${trimmed}". It must be a valid absolute HTTP or HTTPS URL.`
      );
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `[TapMe Config Error] Invalid protocol in VITE_PUBLIC_REDIRECT_BASE_URL: "${trimmed}". Must use http:// or https://.`
      );
    }

    // In production, prohibit localhost, loopback, or LAN IP addresses
    if (isProd) {
      const hostname = parsed.hostname.toLowerCase();
      if (isLanOrLocalAddress(hostname)) {
        throw new Error(
          `[TapMe Config Error] VITE_PUBLIC_REDIRECT_BASE_URL cannot point to localhost, loopback, or a LAN IP in production ("${trimmed}"). Set it to your public Cloudflare Pages domain (e.g., https://<your-project>.pages.dev).`
        );
      }
    }

    return trimmed.replace(/\/+$/, '');
  }

  // If missing in production:
  if (isProd) {
    throw new Error(
      '[TapMe Config Error] VITE_PUBLIC_REDIRECT_BASE_URL is not configured for production. Please set this environment variable to your public Cloudflare Pages domain (e.g., https://<your-project>.pages.dev).'
    );
  }

  return null;
}

/**
 * Resolves the base redirect URL according to environment settings.
 *
 * @param {Record<string, unknown>} [envOverride] - Optional environment override for testing.
 * @returns {string} Clean base URL without trailing slash (e.g. "https://tapme.pages.dev" or "http://127.0.0.1:8787").
 * @throws {Error} When configuration is invalid or missing in production.
 */
export function getBaseRedirectUrl(envOverride) {
  const env = envOverride || (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {});
  const configured = typeof env.VITE_PUBLIC_REDIRECT_BASE_URL === 'string'
    ? env.VITE_PUBLIC_REDIRECT_BASE_URL.trim()
    : undefined;
  const isProd = Boolean(env.PROD);

  const validated = validatePublicRedirectBaseUrl(configured, isProd);
  if (validated) {
    return validated;
  }

  // Canonical TapMe public redirect base URL default
  return CANONICAL_PUBLIC_REDIRECT_BASE_URL;
}

/**
 * Builds the canonical public QR redirect URL for a card.
 * Never encodes customer destination URLs directly; always points to the public redirect route `/r/:public_token`.
 *
 * @param {string} publicToken - The card's permanent public token.
 * @param {Record<string, unknown>} [envOverride] - Optional environment override for testing.
 * @returns {string} The complete canonical redirect URL to encode in the QR code.
 */
export function getPublicCardUrl(publicToken, envOverride) {
  if (typeof publicToken !== 'string' || !publicToken.trim()) {
    throw new Error('[TapMe URL Error] A valid publicToken is required to generate a public card redirect URL.');
  }

  const base = getBaseRedirectUrl(envOverride);
  return `${base}/r/${encodeURIComponent(publicToken.trim())}`;
}

/**
 * Determines whether a URL points to a local, loopback, or LAN development environment.
 * Useful for displaying non-blocking UI notices during development and testing.
 *
 * @param {string} urlString
 * @returns {boolean}
 */
export function isLocalDevelopmentUrl(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return isLanOrLocalAddress(hostname);
  } catch {
    return false;
  }
}
