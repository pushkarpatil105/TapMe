import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import type { AppEnv } from "../types";
import { createCard } from "../cards/cards";
import { createSession, createSessionCookie } from "../auth/session";
import { recordScanEvent, isValidPublicToken, shouldIgnoreScan } from "./public";
import worker from "../index";

const testEnv = env as AppEnv;

let mainAdminId: string;
let mainAdminCookie: string;

beforeEach(async () => {
  mainAdminId = crypto.randomUUID();

  // Create main_admin for creating test cards
  await testEnv.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role)
     VALUES (?, ?, ?, ?)`
  )
    .bind(mainAdminId, `admin_${mainAdminId.slice(0, 8)}`, "hash", "main_admin")
    .run();

  const session = await createSession(testEnv, mainAdminId);
  mainAdminCookie = createSessionCookie(testEnv, session.token);
});

afterEach(async () => {
  await testEnv.DB.prepare("DELETE FROM scan_events").run();
  await testEnv.DB.prepare("DELETE FROM audit_logs").run();
  await testEnv.DB.prepare("DELETE FROM card_links").run();
  await testEnv.DB.prepare("DELETE FROM cards").run();
  await testEnv.DB.prepare("DELETE FROM sessions").run();
  await testEnv.DB.prepare("DELETE FROM admins WHERE id = ?").bind(mainAdminId).run();
});

describe("Public Redirect System — Validation & Unit", () => {
  it("validates public token format correctly", () => {
    // Valid 24-character base64url tokens
    expect(isValidPublicToken("abcDEF123_-xyz7890123456")).toBe(true);
    expect(isValidPublicToken("A1b2C3d4E5f6G7h8I9j0K1l2")).toBe(true);

    // Invalid tokens
    expect(isValidPublicToken("")).toBe(false);
    expect(isValidPublicToken("short")).toBe(false);
    expect(isValidPublicToken("invalid/token/with/slashes")).toBe(false);
    expect(isValidPublicToken("token with spaces")).toBe(false);
    expect(isValidPublicToken("token$with@special!chars")).toBe(false);
    expect(isValidPublicToken(null)).toBe(false);
    expect(isValidPublicToken(undefined)).toBe(false);
  });

  it("identifies prefetch requests and crawlers correctly", () => {
    // Prefetch headers
    expect(
      shouldIgnoreScan(
        new Request("http://localhost:8787/r/test", {
          headers: { Purpose: "prefetch" },
        })
      )
    ).toBe(true);

    expect(
      shouldIgnoreScan(
        new Request("http://localhost:8787/r/test", {
          headers: { "Sec-Purpose": "prefetch" },
        })
      )
    ).toBe(true);

    expect(
      shouldIgnoreScan(
        new Request("http://localhost:8787/r/test", {
          headers: { "Sec-Purpose": "prerender" },
        })
      )
    ).toBe(true);

    // Bot User-Agents
    expect(
      shouldIgnoreScan(
        new Request("http://localhost:8787/r/test", {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          },
        })
      )
    ).toBe(true);

    expect(
      shouldIgnoreScan(
        new Request("http://localhost:8787/r/test", {
          headers: {
            "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
          },
        })
      )
    ).toBe(true);

    expect(
      shouldIgnoreScan(
        new Request("http://localhost:8787/r/test", {
          headers: { "User-Agent": "WhatsApp/2.21.12.21 A" },
        })
      )
    ).toBe(true);

    expect(
      shouldIgnoreScan(
        new Request("http://localhost:8787/r/test", {
          headers: { "User-Agent": "Twitterbot/1.0" },
        })
      )
    ).toBe(true);

    // Legitimate user browser requests
    expect(
      shouldIgnoreScan(
        new Request("http://localhost:8787/r/test", {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          },
        })
      )
    ).toBe(false);

    expect(
      shouldIgnoreScan(
        new Request("http://localhost:8787/r/test", {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
          },
        })
      )
    ).toBe(false);
  });
});

describe("Public Redirect System — Endpoints & Integration", () => {
  it("1. Valid active token with zero enabled links returns unavailable page", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "No Links Cafe",
        qr_type: "all_in_one",
        links: [],
      },
      { business_name: "No Links Cafe", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;

    // HTML request (default browser navigation)
    const resHtml = await worker.fetch(new Request(`http://localhost:8787/r/${token}`), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(resHtml.status).toBe(404);
    const htmlText = await resHtml.text();
    expect(htmlText).toContain("Destinations are not currently available");

    // JSON request
    const resJson = await worker.fetch(new Request(`http://localhost:8787/r/${token}`, {
      headers: { Accept: "application/json" },
    }), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(resJson.status).toBe(404);
    const json = (await resJson.json()) as any;
    expect(json.success).toBe(false);
    expect(json.error).toContain("Destinations are not currently available");
  });

  it("2. Valid active token with one enabled link redirects directly with HTTP 302", async () => {
    const destinationUrl = "https://g.page/r/tapme-test-review";
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Single Link Pizza",
        qr_type: "google_review",
        links: [
          {
            platform: "google_reviews",
            destination_url: destinationUrl,
            is_enabled: true,
          },
        ],
      },
      { business_name: "Single Link Pizza", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;

    const request = new Request(`http://localhost:8787/r/${token}`, {
      redirect: "manual",
    });

    const response = await worker.fetch(request, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(destinationUrl);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("3. Valid active token with multiple enabled links returns selection interface", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Multi Link Bistro",
        qr_type: "all_in_one",
        links: [
          {
            platform: "google_reviews",
            destination_url: "https://g.page/r/bistro-review",
            label: "Review Us on Google",
            display_order: 0,
            is_enabled: true,
          },
          {
            platform: "instagram",
            destination_url: "https://instagram.com/bistro",
            label: "Follow our Instagram",
            display_order: 1,
            is_enabled: true,
          },
        ],
      },
      { business_name: "Multi Link Bistro", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;

    // A. Browser navigation (HTML)
    const resHtml = await worker.fetch(new Request(`http://localhost:8787/r/${token}`), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(resHtml.status).toBe(200);
    const htmlText = await resHtml.text();
    expect(htmlText).toContain("Multi Link Bistro");
    expect(htmlText).toContain("https://g.page/r/bistro-review");
    expect(htmlText).toContain("https://instagram.com/bistro");
    expect(htmlText).toContain("Review Us on Google");
    expect(htmlText).toContain("Follow our Instagram");
    // Destination links must open in the current tab (no target="_blank" and no window.open)
    expect(htmlText).not.toContain('target="_blank"');
    expect(htmlText).not.toContain("target=");
    expect(htmlText).not.toContain("window.open");
    expect(htmlText).toContain('<a href="https://g.page/r/bistro-review" class="link-card">');
    expect(htmlText).toContain('<a href="https://instagram.com/bistro" class="link-card">');

    // B. JSON client request (GET /r/:token with Accept: application/json)
    const resJson = await worker.fetch(new Request(`http://localhost:8787/r/${token}`, {
      headers: { Accept: "application/json" },
    }), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(resJson.status).toBe(200);
    const json = (await resJson.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("multiple");
    expect(json.data.business_name).toBe("Multi Link Bistro");
    expect(json.data.links).toHaveLength(2);
    expect(json.data.links[0].platform).toBe("google_reviews");
    expect(json.data.links[1].platform).toBe("instagram");

    // C. Public customer API (GET /api/public/cards/:token)
    const resApi = await worker.fetch(new Request(`http://localhost:8787/api/public/cards/${token}`), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(resApi.status).toBe(200);
    const apiJson = (await resApi.json()) as any;
    expect(apiJson.success).toBe(true);
    expect(apiJson.data.business_name).toBe("Multi Link Bistro");
    expect(apiJson.data.status).toBe("active");
    expect(apiJson.data.links).toHaveLength(2);
    // Never expose internal IDs
    expect(apiJson.data.card_number).toBeUndefined();
    expect(apiJson.data.created_by).toBeUndefined();
  });

  it("4. Unknown token returns 404 unavailable/not-found response", async () => {
    const unknownToken = "NonExistentToken12345678";

    // /r/:token
    const res = await worker.fetch(new Request(`http://localhost:8787/r/${unknownToken}`), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);
    expect(res.status).toBe(404);
    const htmlText = await res.text();
    expect(htmlText).toContain("Card not found");

    // /api/public/cards/:token
    const resApi = await worker.fetch(new Request(`http://localhost:8787/api/public/cards/${unknownToken}`), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);
    expect(resApi.status).toBe(404);
    const json = (await resApi.json()) as any;
    expect(json.success).toBe(false);
    expect(json.error).toBe("Card not found.");
  });

  it("5. Invalid token format returns 400 Bad Request before database query", async () => {
    // Malformed tokens
    const invalidTokens = ["bad!token", "short", "token with spaces", "nested/token"];

    for (const badToken of invalidTokens) {
      const res = await worker.fetch(new Request(`http://localhost:8787/r/${badToken}`), testEnv, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);
      expect(res.status).toBe(400);

      const resApi = await worker.fetch(new Request(`http://localhost:8787/api/public/cards/${badToken}`), testEnv, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);
      expect(resApi.status).toBe(400);
    }
  });

  it("6. Inactive card returns unavailable page and does not redirect", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Inactive Coffee",
        qr_type: "whatsapp",
        links: [{ platform: "whatsapp", destination_url: "https://wa.me/12345", is_enabled: true }],
      },
      { business_name: "Inactive Coffee", qr_type: "whatsapp" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    // Deactivate the card
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${created.card.card_number}/deactivate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    const token = created.card.public_token;

    // /r/:token must not redirect
    const res = await worker.fetch(new Request(`http://localhost:8787/r/${token}`, { redirect: "manual" }), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(404);
    expect(res.headers.get("Location")).toBeNull();
    const text = await res.text();
    expect(text).toContain("This card is currently unavailable");

    // /api/public/cards/:token
    const resApi = await worker.fetch(new Request(`http://localhost:8787/api/public/cards/${token}`), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(resApi.status).toBe(404);
    const json = (await resApi.json()) as any;
    expect(json.success).toBe(false);
    expect(json.status).toBe("unavailable");
  });

  it("7. Archived card returns unavailable page and does not redirect", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Archived Bakery",
        qr_type: "google_review",
        links: [{ platform: "google_reviews", destination_url: "https://g.page/bakery", is_enabled: true }],
      },
      { business_name: "Archived Bakery", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    // Archive the card
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${created.card.card_number}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    const token = created.card.public_token;

    // /r/:token must not redirect
    const res = await worker.fetch(new Request(`http://localhost:8787/r/${token}`, { redirect: "manual" }), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(404);
    expect(res.headers.get("Location")).toBeNull();
    const text = await res.text();
    expect(text).toContain("This card is currently unavailable");

    // /api/public/cards/:token
    const resApi = await worker.fetch(new Request(`http://localhost:8787/api/public/cards/${token}`), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(resApi.status).toBe(404);
    const json = (await resApi.json()) as any;
    expect(json.success).toBe(false);
    expect(json.status).toBe("unavailable");
  });

  it("8. Disabled links are excluded from public results and single-link resolution", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Mixed Links Store",
        qr_type: "all_in_one",
        links: [
          {
            platform: "google_reviews",
            destination_url: "https://g.page/mixed-enabled",
            is_enabled: true,
          },
          {
            platform: "instagram",
            destination_url: "https://instagram.com/mixed-disabled",
            is_enabled: false,
          },
        ],
      },
      { business_name: "Mixed Links Store", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;

    // For all_in_one, /r/:token always renders the selection page (HTTP 200) with only enabled links
    const res = await worker.fetch(new Request(`http://localhost:8787/r/${token}`, { redirect: "manual" }), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("https://g.page/mixed-enabled");
    expect(html).not.toContain("https://instagram.com/mixed-disabled");

    // Customer API excludes disabled links
    const resApi = await worker.fetch(new Request(`http://localhost:8787/api/public/cards/${token}`), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(resApi.status).toBe(200);
    const json = (await resApi.json()) as any;
    expect(json.data.links).toHaveLength(1);
    expect(json.data.links[0].destination_url).toBe("https://g.page/mixed-enabled");
  });

  it("9. Public requests succeed without cookies", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "No Cookie Shop",
        qr_type: "google_review",
        links: [{ platform: "google_reviews", destination_url: "https://example.com/nocookie", is_enabled: true }],
      },
      { business_name: "No Cookie Shop", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;

    // Explicitly verify no Cookie header
    const req = new Request(`http://localhost:8787/r/${token}`, { redirect: "manual" });
    expect(req.headers.get("Cookie")).toBeNull();

    const res = await worker.fetch(req, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/nocookie");
  });

  it("10. Public requests succeed without Origin headers", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "No Origin Shop",
        qr_type: "google_review",
        links: [{ platform: "google_reviews", destination_url: "https://example.com/noorigin", is_enabled: true }],
      },
      { business_name: "No Origin Shop", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;

    // Explicitly verify no Origin header
    const req = new Request(`http://localhost:8787/r/${token}`, { redirect: "manual" });
    expect(req.headers.get("Origin")).toBeNull();

    const res = await worker.fetch(req, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/noorigin");
  });

  it("11. Public requests do not bypass protection on admin routes", async () => {
    // Attempting to access admin GET route without cookie fails with 401
    const resGetCards = await worker.fetch(new Request("http://localhost:8787/api/cards"), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);
    expect(resGetCards.status).toBe(401);

    // Attempting state-changing admin POST route without Origin fails with 403
    const resPostCard = await worker.fetch(new Request("http://localhost:8787/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_name: "Hacked" }),
    }), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);
    expect(resPostCard.status).toBe(403);
  });

  it("12. Records scan tracking for both direct redirects and multi-link visits", async () => {
    // 1. Single-link card
    const card1 = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Tracked Single",
        qr_type: "whatsapp",
        links: [{ platform: "whatsapp", destination_url: "https://wa.me/111", is_enabled: true }],
      },
      { business_name: "Tracked Single", qr_type: "whatsapp" }
    );
    // 2. Multi-link card
    const card2 = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Tracked Multi",
        qr_type: "all_in_one",
        links: [
          { platform: "google_reviews", destination_url: "https://g.page/222", is_enabled: true },
          { platform: "instagram", destination_url: "https://instagram.com/222", is_enabled: true },
        ],
      },
      { business_name: "Tracked Multi", qr_type: "all_in_one" }
    );

    if (!card1.success || !card2.success) return;

    // Visit single-link
    await worker.fetch(new Request(`http://localhost:8787/r/${card1.card.public_token}`, {
      headers: { "User-Agent": "TapMeTestAgent/1.0", Referer: "https://nfc.tapme" },
      redirect: "manual",
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Visit multi-link
    await worker.fetch(new Request(`http://localhost:8787/r/${card2.card.public_token}`, {
      headers: { "User-Agent": "TapMeTestAgent/2.0", Referer: "https://qr.tapme" },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Inspect scan_events table
    const events = await testEnv.DB.prepare(
      "SELECT card_number, user_agent, referrer FROM scan_events ORDER BY card_number ASC"
    ).all<{ card_number: number; user_agent: string; referrer: string }>();

    expect(events.results).toHaveLength(2);
    expect(events.results[0].card_number).toBe(card1.card.card_number);
    expect(events.results[0].user_agent).toBe("TapMeTestAgent/1.0");
    expect(events.results[0].referrer).toBe("https://nfc.tapme");

    expect(events.results[1].card_number).toBe(card2.card.card_number);
    expect(events.results[1].user_agent).toBe("TapMeTestAgent/2.0");
    expect(events.results[1].referrer).toBe("https://qr.tapme");
  });

  it("13. Scan tracking failure does not block redirects", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Resilient Redirect",
        qr_type: "google_review",
        links: [{ platform: "google_reviews", destination_url: "https://resilient.example.com", is_enabled: true }],
      },
      { business_name: "Resilient Redirect", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    // Verify recordScanEvent handles database failure gracefully
    const mockEnvBrokenDb = {
      ...testEnv,
      DB: {
        prepare: () => {
          throw new Error("Simulated D1 outage");
        },
      },
    } as unknown as AppEnv;

    const scanRecorded = await recordScanEvent(mockEnvBrokenDb, created.card.card_number, new Request("http://localhost:8787"));
    expect(scanRecorded).toBe(false);

    // Now test through the actual worker handler with simulated error
    const spy = vi.spyOn(testEnv.DB, "prepare").mockImplementationOnce((sql: string) => {
      if (sql.includes("INSERT INTO scan_events")) {
        throw new Error("Simulated D1 scan failure");
      }
      return testEnv.DB.prepare(sql);
    });

    const res = await worker.fetch(new Request(`http://localhost:8787/r/${created.card.public_token}`, {
      redirect: "manual",
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // The redirect must STILL succeed with HTTP 302!
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://resilient.example.com");

    spy.mockRestore();
  });

  it("14. Redirect destinations cannot be controlled through visitor query parameters", async () => {
    const legitimateUrl = "https://legitimate.business.com/safe";
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Secure Parameter Shop",
        qr_type: "google_review",
        links: [{ platform: "google_reviews", destination_url: legitimateUrl, is_enabled: true }],
      },
      { business_name: "Secure Parameter Shop", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;

    // Attacker sends open-redirect query parameters
    const maliciousUrls = [
      `http://localhost:8787/r/${token}?redirect_to=https://evil.com`,
      `http://localhost:8787/r/${token}?url=https://attacker.org/phish`,
      `http://localhost:8787/r/${token}?destination=https://malware.test`,
      `http://localhost:8787/r/${token}?target=javascript:alert(1)`,
    ];

    for (const testUrl of maliciousUrls) {
      const res = await worker.fetch(new Request(testUrl, { redirect: "manual" }), testEnv, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(302);
      // Location must strictly equal the database-stored legitimate URL
      expect(res.headers.get("Location")).toBe(legitimateUrl);
    }
  });

  it("15. Prefetch requests are not recorded as scan events but redirect successfully", async () => {
    const destinationUrl = "https://example.com/prefetch-destination";
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Prefetch Test Shop",
        qr_type: "google_review",
        links: [{ platform: "google_reviews", destination_url: destinationUrl, is_enabled: true }],
      },
      { business_name: "Prefetch Test Shop", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;

    // Test with Purpose: prefetch
    const res1 = await worker.fetch(
      new Request(`http://localhost:8787/r/${token}`, {
        headers: {
          Purpose: "prefetch",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        },
        redirect: "manual",
      }),
      testEnv,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );

    expect(res1.status).toBe(302);
    expect(res1.headers.get("Location")).toBe(destinationUrl);

    // Test with Sec-Purpose: prefetch
    const res2 = await worker.fetch(
      new Request(`http://localhost:8787/r/${token}`, {
        headers: {
          "Sec-Purpose": "prefetch",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        },
        redirect: "manual",
      }),
      testEnv,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );

    expect(res2.status).toBe(302);
    expect(res2.headers.get("Location")).toBe(destinationUrl);

    // Check scan_events - nothing should be recorded!
    const events = await testEnv.DB.prepare(
      "SELECT id FROM scan_events WHERE card_number = ?"
    )
      .bind(created.card.card_number)
      .all();

    expect(events.results).toHaveLength(0);
  });

  it("16. Web crawlers and bots are not recorded as scan events but redirect successfully", async () => {
    const destinationUrl = "https://example.com/bot-destination";
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Bot Test Shop",
        qr_type: "google_review",
        links: [{ platform: "google_reviews", destination_url: destinationUrl, is_enabled: true }],
      },
      { business_name: "Bot Test Shop", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;

    const botAgents = [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "WhatsApp/2.21.12.21 A",
      "Twitterbot/1.0",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    ];

    for (const botAgent of botAgents) {
      const res = await worker.fetch(
        new Request(`http://localhost:8787/r/${token}`, {
          headers: { "User-Agent": botAgent },
          redirect: "manual",
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(destinationUrl);
    }

    // Verify no scan events were recorded for these bots
    const events = await testEnv.DB.prepare(
      "SELECT id FROM scan_events WHERE card_number = ?"
    )
      .bind(created.card.card_number)
      .all();

    expect(events.results).toHaveLength(0);
  });

  it("17. Legitimate mobile browser scan is recorded in scan_events", async () => {
    const destinationUrl = "https://example.com/legitimate-scan";
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Human Visit Cafe",
        qr_type: "google_review",
        links: [{ platform: "google_reviews", destination_url: destinationUrl, is_enabled: true }],
      },
      { business_name: "Human Visit Cafe", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;
    const humanUa =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1";

    const res = await worker.fetch(
      new Request(`http://localhost:8787/r/${token}`, {
        headers: { "User-Agent": humanUa, Referer: "https://tapme.link/qr" },
        redirect: "manual",
      }),
      testEnv,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(destinationUrl);

    // Verify exactly 1 scan event recorded
    const events = await testEnv.DB.prepare(
      "SELECT card_number, user_agent, referrer FROM scan_events WHERE card_number = ?"
    )
      .bind(created.card.card_number)
      .all<{ card_number: number; user_agent: string; referrer: string }>();

    expect(events.results).toHaveLength(1);
    expect(events.results[0].user_agent).toBe(humanUa);
    expect(events.results[0].referrer).toBe("https://tapme.link/qr");
  });
});

describe("Phase 3: Immutable QR Types and Redirect Behavior", () => {
  it("Single-purpose: google_review redirects HTTP 302 directly to Google Review URL", async () => {
    const url = "https://g.page/r/test-google-direct";
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Google Single",
        qr_type: "google_review",
        links: [{ platform: "google_reviews", destination_url: url, is_enabled: true }],
      },
      { business_name: "Google Single", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const res = await worker.fetch(new Request(`http://localhost:8787/r/${created.card.public_token}`, {
      redirect: "manual",
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(url);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("Single-purpose: instagram redirects HTTP 302 directly to Instagram URL", async () => {
    const url = "https://instagram.com/direct-shop";
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Insta Single",
        qr_type: "instagram",
        links: [{ platform: "instagram", destination_url: url, is_enabled: true }],
      },
      { business_name: "Insta Single", qr_type: "instagram" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const res = await worker.fetch(new Request(`http://localhost:8787/r/${created.card.public_token}`, {
      redirect: "manual",
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(url);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("Single-purpose: whatsapp redirects HTTP 302 directly to WhatsApp URL", async () => {
    const url = "https://wa.me/919876543210";
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "WhatsApp Single",
        qr_type: "whatsapp",
        links: [{ platform: "whatsapp", destination_url: url, is_enabled: true }],
      },
      { business_name: "WhatsApp Single", qr_type: "whatsapp" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const res = await worker.fetch(new Request(`http://localhost:8787/r/${created.card.public_token}`, {
      redirect: "manual",
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(url);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("Single-purpose: missing destination (unconfigured) returns HTTP 404 unavailable", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Unconfigured Single",
        qr_type: "google_review",
        links: [],
      },
      { business_name: "Unconfigured Single", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const res = await worker.fetch(new Request(`http://localhost:8787/r/${created.card.public_token}`, {
      redirect: "manual",
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    expect(res.status).toBe(404);
    expect(res.headers.get("Location")).toBeNull();
    const html = await res.text();
    expect(html).toContain("Destinations are not currently available");
  });

  it("Single-purpose: disabled destination returns HTTP 404 unavailable", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Disabled Single",
        qr_type: "instagram",
        links: [{ platform: "instagram", destination_url: "https://instagram.com/disabled", is_enabled: false }],
      },
      { business_name: "Disabled Single", qr_type: "instagram" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const res = await worker.fetch(new Request(`http://localhost:8787/r/${created.card.public_token}`, {
      redirect: "manual",
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    expect(res.status).toBe(404);
    expect(res.headers.get("Location")).toBeNull();
    const html = await res.text();
    expect(html).toContain("Destinations are not currently available");
  });

  it("All-in-one: 1 enabled link returns HTTP 200 selection page (never HTTP 302)", async () => {
    const url = "https://example.com/one-and-only";
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "All In One Single Destination",
        qr_type: "all_in_one",
        links: [{ platform: "other", destination_url: url, label: "Our Website", is_enabled: true }],
      },
      { business_name: "All In One Single Destination", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const res = await worker.fetch(new Request(`http://localhost:8787/r/${created.card.public_token}`, {
      redirect: "manual",
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Must be HTTP 200 - NEVER 302!
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
    const html = await res.text();
    expect(html).toContain("All In One Single Destination");
    expect(html).toContain(url);
    expect(html).toContain("Our Website");

    // Also verify JSON client response
    const resJson = await worker.fetch(new Request(`http://localhost:8787/r/${created.card.public_token}`, {
      headers: { Accept: "application/json" },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    expect(resJson.status).toBe(200);
    const json = (await resJson.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("multiple");
    expect(json.data.links).toHaveLength(1);
  });

  it("All-in-one: multiple enabled links return HTTP 200 selection page", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "All In One Multi",
        qr_type: "all_in_one",
        links: [
          { platform: "google_reviews", destination_url: "https://g.page/multi", is_enabled: true },
          { platform: "instagram", destination_url: "https://instagram.com/multi", is_enabled: true },
          { platform: "whatsapp", destination_url: "https://wa.me/911234567890", is_enabled: true },
        ],
      },
      { business_name: "All In One Multi", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const res = await worker.fetch(new Request(`http://localhost:8787/r/${created.card.public_token}`, {
      redirect: "manual",
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("https://g.page/multi");
    expect(html).toContain("https://instagram.com/multi");
    expect(html).toContain("https://wa.me/911234567890");
  });

  it("All-in-one: 0 enabled links (all disabled) returns HTTP 404 unavailable", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "All In One All Disabled",
        qr_type: "all_in_one",
        links: [
          { platform: "google_reviews", destination_url: "https://g.page/multi-dis", is_enabled: false },
          { platform: "instagram", destination_url: "https://instagram.com/multi-dis", is_enabled: false },
        ],
      },
      { business_name: "All In One All Disabled", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const res = await worker.fetch(new Request(`http://localhost:8787/r/${created.card.public_token}`, {
      redirect: "manual",
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Destinations are not currently available");
  });

  it("Unconfigured card returns HTTP 404 on customer API /api/public/cards/:token", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Unconfigured Public API",
        qr_type: "all_in_one",
        links: [],
      },
      { business_name: "Unconfigured Public API", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const resApi = await worker.fetch(new Request(`http://localhost:8787/api/public/cards/${created.card.public_token}`), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(resApi.status).toBe(404);
    const json = (await resApi.json()) as any;
    expect(json.success).toBe(false);
    expect(json.status).toBe("unavailable");
    expect(json.error).toBe("Card is currently unavailable.");
  });

  it("Public responses never leak internal card numbers or creator details", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Privacy Guard Test",
        qr_type: "google_review",
        links: [{ platform: "google_reviews", destination_url: "https://g.page/privacy", is_enabled: true }],
      },
      { business_name: "Privacy Guard Test", qr_type: "google_review" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const token = created.card.public_token;

    // Test API route
    const resApi = await worker.fetch(new Request(`http://localhost:8787/api/public/cards/${token}`), testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(resApi.status).toBe(200);
    const json = (await resApi.json()) as any;
    expect(json.data.card_number).toBeUndefined();
    expect(json.data.created_by).toBeUndefined();
    expect(json.data.public_token).toBeUndefined();
    expect(json.data.qr_type).toBe("google_review");
  });
});
