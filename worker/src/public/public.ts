import type { AppEnv } from "../types";
import { successResponse, errorResponse } from "../utils/responses";

export interface PublicLink {
  id: string;
  platform: string;
  label: string;
  destination_url: string;
  display_order: number;
}

export interface PublicCardResult {
  cardNumber: number;
  businessName: string;
  status: "active" | "inactive" | "archived";
  enabledLinks: PublicLink[];
}

/**
 * Validates the public token format.
 * TapMe public tokens are base64url-encoded strings (typically 24 chars).
 * We enforce 16 to 64 characters of [A-Za-z0-9_-] with no special characters.
 */
export function isValidPublicToken(token: unknown): token is string {
  if (typeof token !== "string") return false;
  const trimmed = token.trim();
  return /^[A-Za-z0-9_-]{16,64}$/.test(trimmed);
}

/**
 * Escapes HTML characters to prevent XSS in customer HTML rendering.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Sanitizes and validates a URL for use in href attributes.
 */
export function sanitizeHref(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return escapeHtml(urlStr);
    }
  } catch {
    // invalid URL
  }
  return "#";
}

/**
 * Known web crawlers, search engines, and social media preview bots.
 * Scanning links from these agents should not be recorded as customer card visits.
 */
export const BOT_USER_AGENT_PATTERN =
  /(bot|crawler|spider|slurp|facebookexternalhit|whatsapp|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|embedly|quora link preview|pinterest|applebot|bingbot|googlebot|duckduckbot|baiduspider|yandexbot|sogou|exabot)/i;

/**
 * Determines whether an incoming request represents a prefetch or automated bot
 * that should be excluded from scan event analytics.
 */
export function shouldIgnoreScan(request: Request): boolean {
  const purpose = request.headers.get("purpose")?.toLowerCase();
  const secPurpose = request.headers.get("sec-purpose")?.toLowerCase();

  // 1. Prefetch / prerender headers sent by browsers
  if (
    purpose === "prefetch" ||
    purpose === "preview" ||
    secPurpose === "prefetch" ||
    secPurpose === "prerender"
  ) {
    return true;
  }

  // 2. Automated bots and link preview crawlers
  const userAgent = request.headers.get("user-agent");
  if (userAgent && BOT_USER_AGENT_PATTERN.test(userAgent)) {
    return true;
  }

  return false;
}

/**
 * Retrieves a card and its enabled destination links by public_token.
 * Does NOT expose internal identifiers, disabled links, or admin data.
 */
export async function getPublicCardByToken(
  env: AppEnv,
  token: string,
): Promise<
  | { valid: false; error: string }
  | { valid: true; found: false }
  | { valid: true; found: true; card: PublicCardResult }
> {
  if (!isValidPublicToken(token)) {
    return { valid: false, error: "Invalid public token format." };
  }

  const cardRow = await env.DB.prepare(
    `SELECT card_number, business_name, status
     FROM cards
     WHERE public_token = ?
     LIMIT 1`
  )
    .bind(token.trim())
    .first<{
      card_number: number;
      business_name: string;
      status: "active" | "inactive" | "archived";
    }>();

  if (!cardRow) {
    return { valid: true, found: false };
  }

  if (cardRow.status !== "active") {
    return {
      valid: true,
      found: true,
      card: {
        cardNumber: cardRow.card_number,
        businessName: cardRow.business_name,
        status: cardRow.status,
        enabledLinks: [],
      },
    };
  }

  // Active card: fetch enabled links only, ordered by display_order ASC
  const linksResult = await env.DB.prepare(
    `SELECT id, platform, label, destination_url, display_order
     FROM card_links
     WHERE card_number = ? AND is_enabled = 1
     ORDER BY display_order ASC, created_at ASC`
  )
    .bind(cardRow.card_number)
    .all<{
      id: string;
      platform: string;
      label: string;
      destination_url: string;
      display_order: number;
    }>();

  const enabledLinks: PublicLink[] = (linksResult.results || []).map((row) => ({
    id: row.id,
    platform: row.platform,
    label: row.label,
    destination_url: row.destination_url,
    display_order: row.display_order,
  }));

  return {
    valid: true,
    found: true,
    card: {
      cardNumber: cardRow.card_number,
      businessName: cardRow.business_name,
      status: "active",
      enabledLinks,
    },
  };
}

/**
 * Records a legitimate card scan attempt in the scan_events table.
 * Adheres strictly to the schema (id, card_number, scanned_at, user_agent, referrer).
 * Never stores raw IP addresses.
 * Ignores prefetch requests and automated bots/crawlers to protect against write amplification.
 * Fails safely without throwing errors so public redirects are never blocked.
 */
export async function recordScanEvent(
  env: AppEnv,
  cardNumber: number,
  request: Request,
): Promise<boolean> {
  try {
    if (shouldIgnoreScan(request)) {
      return false;
    }

    const rawUserAgent = request.headers.get("user-agent");
    const rawReferrer = request.headers.get("referer");

    // Truncate to reasonable limits to prevent unbounded input abuse
    const userAgent = rawUserAgent ? rawUserAgent.slice(0, 500) : null;
    const referrer = rawReferrer ? rawReferrer.slice(0, 500) : null;

    const id = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO scan_events (id, card_number, scanned_at, user_agent, referrer)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)`
    )
      .bind(id, cardNumber, userAgent, referrer)
      .run();

    return true;
  } catch (err: unknown) {
    console.error("Non-fatal: failed to record scan event:", err);
    return false;
  }
}

/**
 * Detects whether the caller requested JSON instead of HTML.
 */
export function shouldReturnJson(request: Request, url: URL): boolean {
  if (url.searchParams.get("format") === "json") return true;
  const accept = request.headers.get("Accept") || "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

/**
 * Renders a high-aesthetic, mobile-friendly HTML customer page for unavailable
 * states and multi-link destination selection.
 */
export function renderPublicHtmlPage(options: {
  title: string;
  heading: string;
  subtitle?: string;
  message?: string;
  links?: PublicLink[];
  isUnavailable?: boolean;
}): string {
  const { title, heading, subtitle, message, links = [], isUnavailable } = options;

  const escapedTitle = escapeHtml(title);
  const escapedHeading = escapeHtml(heading);
  const escapedSubtitle = subtitle ? escapeHtml(subtitle) : "";
  const escapedMessage = message ? escapeHtml(message) : "";

  // Platform badges with tailored colors
  const getPlatformMeta = (platform: string) => {
    switch (platform) {
      case "google_reviews":
        return { label: "Google Reviews", badgeBg: "#ea4335", icon: "★" };
      case "instagram":
        return { label: "Instagram", badgeBg: "#e1306c", icon: "◎" };
      case "whatsapp":
        return { label: "WhatsApp", badgeBg: "#25d366", icon: "💬" };
      default:
        return { label: "Website", badgeBg: "#38bdf8", icon: "↗" };
    }
  };

  const linksHtml =
    links.length > 0
      ? `<div class="links-container">
          ${links
            .map((link) => {
              const meta = getPlatformMeta(link.platform);
              const label = escapeHtml(link.label || meta.label);
              const safeUrl = sanitizeHref(link.destination_url);
              return `
              <a href="${safeUrl}" class="link-card">
                <div class="link-icon" style="background:${meta.badgeBg};">${meta.icon}</div>
                <div class="link-details">
                  <div class="link-label">${label}</div>
                  <div class="link-meta">${escapeHtml(meta.label)}</div>
                </div>
                <div class="link-arrow">→</div>
              </a>`;
            })
            .join("")}
        </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0b0f19;
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    .card-wrapper {
      width: 100%;
      max-width: 440px;
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 32px 24px;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      padding: 4px 10px;
      border-radius: 9999px;
      margin-bottom: 20px;
    }
    .heading {
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 6px;
      word-break: break-word;
    }
    .subtitle {
      font-size: 14px;
      color: #94a3b8;
      margin-bottom: 24px;
    }
    .message-box {
      background: rgba(244, 63, 94, 0.08);
      border: 1px solid rgba(244, 63, 94, 0.2);
      border-radius: 12px;
      padding: 18px 16px;
      color: #fda4af;
      font-size: 14px;
      line-height: 1.5;
      margin: 16px 0;
    }
    .links-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 8px;
    }
    .link-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      text-decoration: none;
      color: #ffffff;
      transition: all 0.2s ease;
    }
    .link-card:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(56, 189, 248, 0.4);
      transform: translateY(-1px);
    }
    .link-icon {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: bold;
      color: #ffffff;
      flex-shrink: 0;
    }
    .link-details {
      flex: 1;
      text-align: left;
    }
    .link-label {
      font-size: 15px;
      font-weight: 600;
      color: #ffffff;
    }
    .link-meta {
      font-size: 12px;
      color: #94a3b8;
      margin-top: 2px;
    }
    .link-arrow {
      font-size: 16px;
      color: #64748b;
    }
    .footer {
      margin-top: 28px;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card-wrapper">
    <div class="brand-badge">TapMe Card</div>
    <h1 class="heading">${escapedHeading}</h1>
    ${escapedSubtitle ? `<p class="subtitle">${escapedSubtitle}</p>` : ""}
    ${escapedMessage ? `<div class="message-box">${escapedMessage}</div>` : ""}
    ${linksHtml}
    <div class="footer">TapMe Smart Business Platform</div>
  </div>
</body>
</html>`;
}

/**
 * Handles GET /r/:public_token
 * - Validates public_token format before querying D1.
 * - Handles 0 enabled links, 1 enabled link, multiple enabled links, inactive, and archived cards.
 * - Does not require Origin or Cookie.
 * - Records scan events safely.
 * - Cannot be influenced by visitor query parameters.
 */
export async function handlePublicRedirect(
  request: Request,
  env: AppEnv,
  url: URL,
): Promise<Response> {
  const token = url.pathname.slice("/r/".length);

  // Check for malformed path such as trailing slashes or nested paths
  if (!token || token.includes("/")) {
    return createUnavailableResponse(
      request,
      url,
      "Invalid card token format.",
      400
    );
  }

  // 1. Validate public token format before querying D1
  if (!isValidPublicToken(token)) {
    return createUnavailableResponse(
      request,
      url,
      "Invalid public token format.",
      400
    );
  }

  // 2. Query D1 for card and enabled links
  const result = await getPublicCardByToken(env, token);

  if (!result.valid) {
    return createUnavailableResponse(request, url, result.error, 400);
  }

  if (!result.found) {
    return createUnavailableResponse(
      request,
      url,
      "Card not found.",
      404
    );
  }

  const { card } = result;

  // 3. Inactive or archived cards
  if (card.status !== "active") {
    return createUnavailableResponse(
      request,
      url,
      "This card is currently unavailable.",
      404
    );
  }

  // 4. Zero enabled links
  if (card.enabledLinks.length === 0) {
    return createUnavailableResponse(
      request,
      url,
      "Destinations are not currently available for this card.",
      404
    );
  }

  // 5. Exactly ONE enabled link: redirect directly
  if (card.enabledLinks.length === 1) {
    const destination = card.enabledLinks[0].destination_url;

    // Record scan event; scan failure does NOT block redirect
    await recordScanEvent(env, card.cardNumber, request);

    // Direct HTTP 302 redirect to the D1-stored URL only
    return new Response(null, {
      status: 302,
      headers: {
        Location: destination,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  }

  // 6. MULTIPLE enabled links: render customer selection interface
  await recordScanEvent(env, card.cardNumber, request);

  if (shouldReturnJson(request, url)) {
    return Response.json(
      {
        success: true,
        data: {
          status: "multiple",
          business_name: card.businessName,
          links: card.enabledLinks,
        },
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const html = renderPublicHtmlPage({
    title: `${card.businessName} — TapMe`,
    heading: card.businessName,
    subtitle: "Select a destination below to connect",
    links: card.enabledLinks,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Handles GET /api/public/cards/:public_token
 * - Safe read-only API endpoint for customer-facing interfaces.
 * - Does not expose internal IDs, sequential numbers, or admin details.
 */
export async function handlePublicCardApi(
  request: Request,
  env: AppEnv,
  url: URL,
): Promise<Response> {
  const token = url.pathname.slice("/api/public/cards/".length);

  if (!token) {
    return errorResponse("Card not found.", 404);
  }

  if (token.includes("/") || !isValidPublicToken(token)) {
    return errorResponse("Invalid public token format.", 400);
  }

  const result = await getPublicCardByToken(env, token);

  if (!result.valid) {
    return errorResponse(result.error, 400);
  }

  if (!result.found) {
    return errorResponse("Card not found.", 404);
  }

  const { card } = result;

  if (card.status !== "active") {
    return Response.json(
      {
        success: false,
        error: "Card is currently unavailable.",
        status: "unavailable",
      },
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  return successResponse({
    business_name: card.businessName,
    status: "active",
    links: card.enabledLinks,
  });
}

function createUnavailableResponse(
  request: Request,
  url: URL,
  message: string,
  statusCode: number,
): Response {
  if (shouldReturnJson(request, url)) {
    return Response.json(
      {
        success: false,
        error: message,
        status: "unavailable",
      },
      {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const html = renderPublicHtmlPage({
    title: "Card Unavailable — TapMe",
    heading: "Card Unavailable",
    message,
    isUnavailable: true,
  });

  return new Response(html, {
    status: statusCode,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
