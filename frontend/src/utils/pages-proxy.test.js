import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleProxy, sanitizeHeaders } from '../../functions/_proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Cloudflare Pages Functions Same-Origin Proxy Layer', () => {
  describe('1. Hop-by-hop header sanitization', () => {
    it('strips RFC 7230 hop-by-hop headers and preserves standard headers', () => {
      const incoming = new Headers({
        'connection': 'keep-alive',
        'keep-alive': 'timeout=5, max=1000',
        'proxy-authenticate': 'Basic',
        'proxy-authorization': 'Bearer xyz',
        'te': 'trailers',
        'trailers': 'X-Test',
        'transfer-encoding': 'chunked',
        'upgrade': 'websocket',
        'cookie': 'tapme_session=test-token-123',
        'origin': 'https://tapme.pages.dev',
        'content-type': 'application/json',
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
      });

      const cleaned = sanitizeHeaders(incoming);

      // Verify hop-by-hop headers are stripped
      assert.strictEqual(cleaned.get('connection'), null);
      assert.strictEqual(cleaned.get('keep-alive'), null);
      assert.strictEqual(cleaned.get('proxy-authenticate'), null);
      assert.strictEqual(cleaned.get('proxy-authorization'), null);
      assert.strictEqual(cleaned.get('te'), null);
      assert.strictEqual(cleaned.get('trailers'), null);
      assert.strictEqual(cleaned.get('transfer-encoding'), null);
      assert.strictEqual(cleaned.get('upgrade'), null);

      // Verify legitimate application headers are preserved
      assert.strictEqual(cleaned.get('cookie'), 'tapme_session=test-token-123');
      assert.strictEqual(cleaned.get('origin'), 'https://tapme.pages.dev');
      assert.strictEqual(cleaned.get('content-type'), 'application/json');
      assert.strictEqual(cleaned.get('accept'), 'application/json');
      assert.strictEqual(cleaned.get('user-agent'), 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
    });
  });

  describe('2. Request & Response Forwarding via Service Binding', () => {
    it('forwards GET /api/health to backend and returns JSON response', async () => {
      let capturedUrl = null;
      let capturedInit = null;

      const mockBackend = {
        fetch: async (url, init) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(JSON.stringify({ status: 'ok', service: 'TapMe API' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        },
      };

      const request = new Request('https://tapme.pages.dev/api/health', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      const response = await handleProxy({ request, env: { BACKEND: mockBackend } });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(capturedUrl, 'https://tapme.pages.dev/api/health');
      assert.strictEqual(capturedInit.method, 'GET');
      assert.strictEqual(capturedInit.redirect, 'manual');
      assert.strictEqual(capturedInit.headers.get('accept'), 'application/json');

      const body = await response.json();
      assert.strictEqual(body.status, 'ok');
    });

    it('forwards POST /api/auth/login with credentials and preserves backend Set-Cookie header', async () => {
      let capturedInit = null;
      const expectedCookie =
        'tapme_session=secret-token-abc; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400';

      const mockBackend = {
        fetch: async (url, init) => {
          capturedInit = init;
          const res = new Response(
            JSON.stringify({
              success: true,
              data: { id: 'admin-1', username: 'superadmin', role: 'main_admin' },
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': expectedCookie,
              },
            }
          );
          return res;
        },
      };

      const request = new Request('https://tapme.pages.dev/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://tapme.pages.dev',
        },
        body: JSON.stringify({ username: 'superadmin', password: 'Password12345!' }),
      });

      const response = await handleProxy({ request, env: { BACKEND: mockBackend } });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(capturedInit.method, 'POST');
      assert.strictEqual(capturedInit.headers.get('origin'), 'https://tapme.pages.dev');
      assert.strictEqual(capturedInit.headers.get('content-type'), 'application/json');

      // Crucial: Set-Cookie must reach caller unchanged
      assert.strictEqual(response.headers.get('Set-Cookie'), expectedCookie);

      const json = await response.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.username, 'superadmin');
    });

    it('forwards GET /api/auth/me with Cookie header to backend', async () => {
      let capturedCookie = null;

      const mockBackend = {
        fetch: async (url, init) => {
          capturedCookie = init.headers.get('cookie');
          return new Response(
            JSON.stringify({ success: true, data: { id: 'admin-1', username: 'superadmin' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        },
      };

      const sessionCookie = 'tapme_session=existing-session-token-43-chars-long';
      const request = new Request('https://tapme.pages.dev/api/auth/me', {
        method: 'GET',
        headers: { Cookie: sessionCookie },
      });

      const response = await handleProxy({ request, env: { BACKEND: mockBackend } });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(capturedCookie, sessionCookie);
    });

    it('forwards GET /r/:public_token and preserves backend 302 redirect with Location header', async () => {
      const destination = 'https://g.page/r/tapme-google-review';
      let capturedRedirect = null;

      const mockBackend = {
        fetch: async (url, init) => {
          capturedRedirect = init.redirect;
          return new Response(null, {
            status: 302,
            headers: {
              Location: destination,
              'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
          });
        },
      };

      const request = new Request('https://tapme.pages.dev/r/test-public-token-12345', {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      const response = await handleProxy({ request, env: { BACKEND: mockBackend } });

      // Verifies manual redirect mode so the 302 is returned to the client rather than followed
      assert.strictEqual(capturedRedirect, 'manual');
      assert.strictEqual(response.status, 302);
      assert.strictEqual(response.headers.get('Location'), destination);
      assert.strictEqual(response.headers.get('Cache-Control'), 'no-cache, no-store, must-revalidate');
    });

    it('preserves query parameters on API requests (e.g., pagination and status filters)', async () => {
      let forwardedUrl = null;

      const mockBackend = {
        fetch: async (url) => {
          forwardedUrl = url;
          return new Response(JSON.stringify({ success: true, data: { items: [], total: 0 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      };

      const targetUrl = 'https://tapme.pages.dev/api/cards?page=2&limit=10&status=active';
      const request = new Request(targetUrl, { method: 'GET' });

      const response = await handleProxy({ request, env: { BACKEND: mockBackend } });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(forwardedUrl, targetUrl);
    });

    it('handles GET and HEAD requests without sending a body', async () => {
      let capturedInit = null;

      const mockBackend = {
        fetch: async (url, init) => {
          capturedInit = init;
          return new Response(null, { status: 200 });
        },
      };

      for (const method of ['GET', 'HEAD']) {
        const req = new Request(`https://tapme.pages.dev/api/health`, { method });
        await handleProxy({ request: req, env: { BACKEND: mockBackend } });
        assert.strictEqual(capturedInit.body, undefined);
      }
    });
  });

  describe('3. Fault tolerance and secret safety', () => {
    it('returns safe 502 JSON error when BACKEND service binding is missing', async () => {
      const request = new Request('https://tapme.pages.dev/api/health');
      const response = await handleProxy({ request, env: {} });

      assert.strictEqual(response.status, 502);
      assert.strictEqual(response.headers.get('Content-Type'), 'application/json');

      const body = await response.json();
      assert.strictEqual(body.success, false);
      assert.match(body.error, /BACKEND service binding is not configured/);
    });

    it('returns safe 502 JSON error when backend service throws, without exposing internals', async () => {
      const mockBackend = {
        fetch: async () => {
          throw new Error('D1 connection timeout: secret_connection_string_internal');
        },
      };

      const request = new Request('https://tapme.pages.dev/api/cards');
      const response = await handleProxy({ request, env: { BACKEND: mockBackend } });

      assert.strictEqual(response.status, 502);
      assert.strictEqual(response.headers.get('Content-Type'), 'application/json');

      const body = await response.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'Bad gateway: failed to communicate with backend service.');
      // Must NOT leak database or internal connection errors
      assert.doesNotMatch(JSON.stringify(body), /secret_connection_string/);
    });
  });

  describe('4. Routing configuration & loop prevention (_routes.json)', () => {
    it('contains valid _routes.json including exactly /api/*, /api, /r/*, /r', () => {
      const routesPath = resolve(__dirname, '../../public/_routes.json');
      assert.strictEqual(existsSync(routesPath), true, '_routes.json must exist in frontend/public');

      const content = JSON.parse(readFileSync(routesPath, 'utf-8'));
      assert.strictEqual(content.version, 1);
      assert.deepStrictEqual(content.include, ['/api/*', '/api', '/r/*', '/r']);
      assert.deepStrictEqual(content.exclude, []);
    });

    it('ensures frontend SPA routes are not included in Functions routing table', () => {
      const routesPath = resolve(__dirname, '../../public/_routes.json');
      const content = JSON.parse(readFileSync(routesPath, 'utf-8'));

      const spaRoutes = ['/', '/login', '/dashboard', '/assets/*', '/favicon.ico', '/index.html'];

      for (const route of spaRoutes) {
        assert.strictEqual(
          content.include.includes(route),
          false,
          `SPA route ${route} must not trigger Pages Functions`
        );
      }
    });
  });
});
