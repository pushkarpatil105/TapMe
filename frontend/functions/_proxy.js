/**
 * Hop-by-hop headers that must not be forwarded across proxies according to RFC 7230 §6.1.
 */
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
];

/**
 * Strips hop-by-hop headers from a Headers instance.
 *
 * @param {Headers} headers - The incoming request headers.
 * @returns {Headers} Sanitized headers safe for proxy forwarding.
 */
export function sanitizeHeaders(headers) {
  const clean = new Headers(headers);
  for (const h of HOP_BY_HOP_HEADERS) {
    clean.delete(h);
  }
  return clean;
}

/**
 * Handles same-origin proxying from Cloudflare Pages Function to the backend Worker
 * via a Cloudflare Service Binding (`env.BACKEND`).
 *
 * Preserves:
 * - Request method, URL pathname, and query parameters
 * - Request headers (Cookie, Origin, Content-Type, Accept, User-Agent, etc.)
 * - Request body on POST/PUT/PATCH/DELETE
 * - Response status code (including HTTP 302, 200, 401, 403, 404, etc.)
 * - Response headers (Set-Cookie, Location, Cache-Control, Content-Type)
 * - Safe error handling without leaking internal details or credentials
 *
 * @param {import('@cloudflare/workers-types').EventContext<any, any, any> | { request: Request, env: any }} context
 * @returns {Promise<Response>}
 */
export async function handleProxy(context) {
  const { request, env } = context;

  // 1. Verify Service Binding availability
  if (!env || !env.BACKEND || typeof env.BACKEND.fetch !== 'function') {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Service unavailable: BACKEND service binding is not configured.',
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  // 2. Prepare safe forwarding options
  try {
    const cleanHeaders = sanitizeHeaders(request.headers);
    const method = request.method.toUpperCase();
    const hasBody = !['GET', 'HEAD'].includes(method) && request.body !== null;

    const forwardInit = {
      method,
      headers: cleanHeaders,
      redirect: 'manual', // Strictly manual to preserve 302 Location headers
    };

    if (hasBody) {
      forwardInit.body = request.body;
      forwardInit.duplex = 'half';
    }

    // Forward request to backend Worker via Cloudflare Service Binding
    const backendResponse = await env.BACKEND.fetch(request.url, forwardInit);

    // Return the response directly, preserving Set-Cookie, Location, Content-Type, etc.
    return backendResponse;
  } catch (err) {
    // Non-fatal logging without exposing sensitive data
    console.error('[Pages Proxy Error] Failed to reach backend service:', err?.message || err);

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Bad gateway: failed to communicate with backend service.',
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
