import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import type { AppEnv } from "../src/types";
import { createSession, createSessionCookie } from "../src/auth/session";
import worker from "../src/index";

const testEnv = env as AppEnv;

let mainAdminId: string;
let staffAdminId: string;
let staff2AdminId: string;
let mainAdminCookie: string;
let staffCookie: string;
let staff2Cookie: string;

const authHeaders = (cookie: string) => ({
  Cookie: cookie,
  "Content-Type": "application/json",
  Origin: "http://localhost:5173",
});

beforeEach(async () => {
  mainAdminId = crypto.randomUUID();
  staffAdminId = crypto.randomUUID();
  staff2AdminId = crypto.randomUUID();

  // Create main_admin
  await testEnv.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'active')`
  )
    .bind(mainAdminId, `main_${mainAdminId.slice(0, 8)}`, "hash", "main_admin")
    .run();

  // Create staff 1
  await testEnv.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'active')`
  )
    .bind(staffAdminId, `staff1_${staffAdminId.slice(0, 8)}`, "hash", "staff")
    .run();

  // Create staff 2
  await testEnv.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'active')`
  )
    .bind(staff2AdminId, `staff2_${staff2AdminId.slice(0, 8)}`, "hash", "staff")
    .run();

  const mainSession = await createSession(testEnv, mainAdminId);
  mainAdminCookie = createSessionCookie(testEnv, mainSession.token);

  const staffSession = await createSession(testEnv, staffAdminId);
  staffCookie = createSessionCookie(testEnv, staffSession.token);

  const staff2Session = await createSession(testEnv, staff2AdminId);
  staff2Cookie = createSessionCookie(testEnv, staff2Session.token);
});

afterEach(async () => {
  await testEnv.DB.prepare("DELETE FROM scan_events").run();
  await testEnv.DB.prepare("DELETE FROM audit_logs").run();
  await testEnv.DB.prepare("DELETE FROM card_links").run();
  await testEnv.DB.prepare("DELETE FROM cards").run();
  await testEnv.DB.prepare("DELETE FROM sessions").run();
  await testEnv.DB.prepare("DELETE FROM admins WHERE id IN (?, ?, ?)").bind(mainAdminId, staffAdminId, staff2AdminId).run();
});

describe("Phase 5: Full End-to-End Integration & Reliability Suite", () => {
  describe("1. Card Creation & Preprinted QR Workflow (All 4 QR Types)", () => {
    it("creates preprinted unconfigured cards with zero links for all four QR types", async () => {
      const types = ["google_review", "instagram", "whatsapp", "all_in_one"] as const;

      for (const qrType of types) {
        const res = await worker.fetch(
          new Request("http://localhost:8787/api/cards", {
            method: "POST",
            headers: authHeaders(staffCookie),
            body: JSON.stringify({
              business_name: `Preprinted ${qrType}`,
              qr_type: qrType,
              links: [],
            }),
          }),
          testEnv,
          { waitUntil: () => {}, passThroughOnException: () => {} } as any
        );

        expect(res.status).toBe(201);
        const json = (await res.json()) as any;
        expect(json.success).toBe(true);
        expect(json.data.qr_type).toBe(qrType);
        expect(json.data.configured_at).toBeNull();
        expect(json.data.is_configured).toBe(false);
        expect(json.data.links).toHaveLength(0);
        expect(json.data.status).toBe("active");
        expect(json.data.public_token).toHaveLength(24);
        expect(json.data.card_number).toBeGreaterThan(0);
      }
    });

    it("strictly prevents modification of permanent card_number, public_token, and qr_type", async () => {
      // 1. Create a card
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
          body: JSON.stringify({
            business_name: "Permanent Test Card",
            qr_type: "google_review",
            links: [],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = ((await createRes.json()) as any).data;
      expect(card).toBeDefined();

      // 2. Attempt API PATCH with prohibited permanent fields
      const patchFields = [
        { card_number: 999 },
        { public_token: "hacked_token_1234567890" },
        { qr_type: "instagram" },
      ];

      for (const forbiddenPayload of patchFields) {
        const patchRes = await worker.fetch(
          new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
            method: "PATCH",
            headers: authHeaders(mainAdminCookie),
            body: JSON.stringify(forbiddenPayload),
          }),
          testEnv,
          { waitUntil: () => {}, passThroughOnException: () => {} } as any
        );
        expect(patchRes.status).toBe(400);
        const patchJson = (await patchRes.json()) as any;
        expect(patchJson.success).toBe(false);
        expect(patchJson.error).toContain("permanent and cannot be modified");
      }

      // 3. Attempt direct SQL UPDATE on permanent fields (verifying DB triggers)
      await expect(
        testEnv.DB.prepare("UPDATE cards SET qr_type = 'instagram' WHERE card_number = ?")
          .bind(card.card_number)
          .run()
      ).rejects.toThrow(/QR type is permanent/i);

      await expect(
        testEnv.DB.prepare("UPDATE cards SET card_number = 888 WHERE card_number = ?")
          .bind(card.card_number)
          .run()
      ).rejects.toThrow(/Card number is permanent/i);

      await expect(
        testEnv.DB.prepare("UPDATE cards SET public_token = 'new_token_1234567890123' WHERE card_number = ?")
          .bind(card.card_number)
          .run()
      ).rejects.toThrow(/Public token is permanent/i);
    });
  });

  describe("2. Card Configuration, Permissions & Concurrency Control", () => {
    it("allows staff to configure an unconfigured card once, permanently consuming the allowance", async () => {
      // Create unconfigured instagram card
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(staffCookie),
          body: JSON.stringify({
            business_name: "Staff Cafe",
            qr_type: "instagram",
            links: [],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = ((await createRes.json()) as any).data;
      expect(card).toBeDefined();
      expect(card.configured_at).toBeNull();

      // Initial configuration by staff
      const configRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: authHeaders(staffCookie),
          body: JSON.stringify({
            business_name: "Staff Cafe Updated",
            links: [
              { platform: "instagram", destination_url: "https://instagram.com/staffcafe", is_enabled: true },
            ],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(configRes.status).toBe(200);
      const configuredCard = ((await configRes.json()) as any).data;
      expect(configuredCard.configured_at).not.toBeNull();
      expect(configuredCard.is_configured).toBe(true);
      expect(configuredCard.business_name).toBe("Staff Cafe Updated");

      // Second configuration attempt by staff must be rejected with 403
      const secondAttempt = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: authHeaders(staffCookie),
          body: JSON.stringify({
            business_name: "Staff Cafe Second Try",
            links: [
              { platform: "instagram", destination_url: "https://instagram.com/staffcafe2", is_enabled: true },
            ],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(secondAttempt.status).toBe(403);
      const secondJson = (await secondAttempt.json()) as any;
      expect(secondJson.error).toContain("Staff members are not permitted to edit already-configured cards");

      // Main Admin CAN edit the already-configured card
      const adminEditRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: authHeaders(mainAdminCookie),
          body: JSON.stringify({
            business_name: "Main Admin Managed Cafe",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(adminEditRes.status).toBe(200);
      const adminEditedCard = ((await adminEditRes.json()) as any).data;
      expect(adminEditedCard.business_name).toBe("Main Admin Managed Cafe");
    });

    it("enforces single-purpose platform constraints during configuration", async () => {
      // Create google_review card
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(staffCookie),
          body: JSON.stringify({
            business_name: "Review Test",
            qr_type: "google_review",
            links: [],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = ((await createRes.json()) as any).data;
      expect(card).toBeDefined();

      // Attempt configuring with wrong platform (instagram link on google_review card)
      const wrongPlatformRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: authHeaders(staffCookie),
          body: JSON.stringify({
            links: [{ platform: "instagram", destination_url: "https://instagram.com/wrong", is_enabled: true }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(wrongPlatformRes.status).toBe(400);
      const wrongJson = (await wrongPlatformRes.json()) as any;
      expect(wrongJson.error).toContain("must be 'google_reviews'");

      // Attempt configuring with >1 link on single-purpose card
      const multiLinkRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: authHeaders(staffCookie),
          body: JSON.stringify({
            links: [
              { platform: "google_reviews", destination_url: "https://g.page/r/1", is_enabled: true },
              { platform: "instagram", destination_url: "https://instagram.com/test", is_enabled: true },
            ],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(multiLinkRes.status).toBe(400);
      const multiJson = (await multiLinkRes.json()) as any;
      expect(multiJson.error).toContain("allow at most 1 destination link");
    });

    it("aborts concurrent staff configuration attempts atomically without data corruption", async () => {
      // Create unconfigured all_in_one card
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
          body: JSON.stringify({
            business_name: "Race Condition Store",
            qr_type: "all_in_one",
            links: [],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = ((await createRes.json()) as any).data;
      expect(card).toBeDefined();

      // Simulate simultaneous configuration by Staff 1 and Staff 2
      const [res1, res2] = await Promise.all([
        worker.fetch(
          new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
            method: "PATCH",
            headers: authHeaders(staffCookie),
            body: JSON.stringify({
              business_name: "Winner 1",
              links: [{ platform: "whatsapp", destination_url: "https://wa.me/1111111111", is_enabled: true }],
            }),
          }),
          testEnv,
          { waitUntil: () => {}, passThroughOnException: () => {} } as any
        ),
        worker.fetch(
          new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
            method: "PATCH",
            headers: authHeaders(staff2Cookie),
            body: JSON.stringify({
              business_name: "Winner 2",
              links: [{ platform: "instagram", destination_url: "https://instagram.com/winner2", is_enabled: true }],
            }),
          }),
          testEnv,
          { waitUntil: () => {}, passThroughOnException: () => {} } as any
        ),
      ]);

      const statuses = [res1.status, res2.status];
      // Exactly one request must succeed (200), and the losing request must be rejected (403)
      expect(statuses).toContain(200);
      expect(statuses).toContain(403);

      // Verify card state is consistent
      const verifyRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "GET",
          headers: { Cookie: mainAdminCookie },
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const finalCard = ((await verifyRes.json()) as any).data;
      expect(finalCard.configured_at).not.toBeNull();
      expect(finalCard.links).toHaveLength(1);
    });
  });

  describe("3. Customer-Facing Public Redirect Flow", () => {
    it("redirects single-purpose cards with HTTP 302 directly to the destination", async () => {
      // 1. Google Review
      const gCard = ((await (await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
          body: JSON.stringify({
            business_name: "Google Review Direct",
            qr_type: "google_review",
            links: [{ platform: "google_reviews", destination_url: "https://g.page/r/my-business-review", is_enabled: true }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      )).json()) as any).data;

      const gRes = await worker.fetch(
        new Request(`http://localhost:8787/r/${gCard.public_token}`, { redirect: "manual" }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(gRes.status).toBe(302);
      expect(gRes.headers.get("Location")).toBe("https://g.page/r/my-business-review");

      // 2. Instagram
      const igCard = ((await (await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
          body: JSON.stringify({
            business_name: "IG Direct",
            qr_type: "instagram",
            links: [{ platform: "instagram", destination_url: "https://instagram.com/direct_test", is_enabled: true }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      )).json()) as any).data;

      const igRes = await worker.fetch(
        new Request(`http://localhost:8787/r/${igCard.public_token}`, { redirect: "manual" }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(igRes.status).toBe(302);
      expect(igRes.headers.get("Location")).toBe("https://instagram.com/direct_test");

      // 3. WhatsApp
      const waCard = ((await (await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
          body: JSON.stringify({
            business_name: "WA Direct",
            qr_type: "whatsapp",
            links: [{ platform: "whatsapp", destination_url: "https://wa.me/919999999999", is_enabled: true }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      )).json()) as any).data;

      const waRes = await worker.fetch(
        new Request(`http://localhost:8787/r/${waCard.public_token}`, { redirect: "manual" }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(waRes.status).toBe(302);
      expect(waRes.headers.get("Location")).toBe("https://wa.me/919999999999");
    });

    it("renders destination selection page for All-in-One cards, even with exactly 1 enabled destination", async () => {
      const aioCard = ((await (await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
          body: JSON.stringify({
            business_name: "All In One Single Destination",
            qr_type: "all_in_one",
            links: [{ platform: "other", destination_url: "https://example.com/single", label: "Our Homepage", is_enabled: true }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      )).json()) as any).data;

      // Must return HTTP 200 with HTML selection interface, NOT HTTP 302 redirect
      const aioRes = await worker.fetch(
        new Request(`http://localhost:8787/r/${aioCard.public_token}`, { redirect: "manual" }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(aioRes.status).toBe(200);
      const html = await aioRes.text();
      expect(html).toContain("All In One Single Destination");
      expect(html).toContain("Our Homepage");
      expect(html).toContain("https://example.com/single");
      expect(aioRes.headers.get("Location")).toBeNull();
    });

    it("returns HTTP 404 unavailable for unconfigured, inactive, archived, or zero-link cards", async () => {
      // 1. Unconfigured card (0 links)
      const unconfCard = ((await (await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
          body: JSON.stringify({
            business_name: "Unconfigured Public Test",
            qr_type: "all_in_one",
            links: [],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      )).json()) as any).data;

      const unconfRes = await worker.fetch(
        new Request(`http://localhost:8787/r/${unconfCard.public_token}`, { redirect: "manual" }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(unconfRes.status).toBe(404);

      // 2. Inactive card
      await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${unconfCard.card_number}/deactivate`, {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const inactiveRes = await worker.fetch(
        new Request(`http://localhost:8787/r/${unconfCard.public_token}`, { redirect: "manual" }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(inactiveRes.status).toBe(404);

      // 3. Archived card
      await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${unconfCard.card_number}/archive`, {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const archivedRes = await worker.fetch(
        new Request(`http://localhost:8787/r/${unconfCard.public_token}`, { redirect: "manual" }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(archivedRes.status).toBe(404);
    });
  });

  describe("4. Dashboard QR Inventory Scanner & Token Lookup", () => {
    it("allows staff and admin to lookup cards by permanent token without generating scan analytics", async () => {
      const card = ((await (await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
          body: JSON.stringify({
            business_name: "Inventory Lookup Test",
            qr_type: "instagram",
            links: [{ platform: "instagram", destination_url: "https://instagram.com/inventory", is_enabled: true }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      )).json()) as any).data;

      // Initial scan count is 0
      const initialScans = await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM scan_events WHERE card_number = ?")
        .bind(card.card_number)
        .first<{ total: number }>();
      expect(Number(initialScans?.total || 0)).toBe(0);

      // Staff looks up card via authenticated scanner endpoint
      const lookupRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/lookup-by-token/${card.public_token}`, {
          method: "GET",
          headers: { Cookie: staffCookie },
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(lookupRes.status).toBe(200);
      const lookupData = ((await lookupRes.json()) as any).data;
      expect(lookupData.business_name).toBe("Inventory Lookup Test");
      expect(lookupData.qr_type).toBe("instagram");
      expect(lookupData.card_number).toBe(card.card_number);

      // Inventory lookup MUST NOT insert scan_events records
      const afterScans = await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM scan_events WHERE card_number = ?")
        .bind(card.card_number)
        .first<{ total: number }>();
      expect(Number(afterScans?.total || 0)).toBe(0);

      // Only public visit records a scan event
      await worker.fetch(
        new Request(`http://localhost:8787/r/${card.public_token}`, { redirect: "manual" }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const finalScans = await testEnv.DB.prepare("SELECT COUNT(*) AS total FROM scan_events WHERE card_number = ?")
        .bind(card.card_number)
        .first<{ total: number }>();
      expect(Number(finalScans?.total || 0)).toBe(1);
    });
  });

  describe("5. Lifecycle, Inventory & Audit Trail Atomicity", () => {
    it("records atomic audit log records for card creation, configuration, lifecycle status transitions", async () => {
      // 1. Create card
      const card = ((await (await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
          body: JSON.stringify({
            business_name: "Audit Trail Test",
            qr_type: "all_in_one",
            links: [],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      )).json()) as any).data;

      // 2. Configure card
      await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: authHeaders(staffCookie),
          body: JSON.stringify({
            links: [{ platform: "whatsapp", destination_url: "https://wa.me/1234567890", is_enabled: true }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      // 3. Deactivate card
      await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}/deactivate`, {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      // 4. Activate card
      await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}/activate`, {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      // 5. Archive card
      await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}/archive`, {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      // 6. Restore card (restoring sets status to inactive)
      const restoreRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}/restore`, {
          method: "POST",
          headers: authHeaders(mainAdminCookie),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const restoredCard = ((await restoreRes.json()) as any).data;
      expect(restoredCard.status).toBe("inactive");

      // Verify all audit logs recorded in order
      const auditRows = await testEnv.DB.prepare(
        "SELECT action, admin_id FROM audit_logs WHERE entity_id = ? ORDER BY created_at ASC"
      )
        .bind(String(card.card_number))
        .all<{ action: string; admin_id: string }>();

      const recordedActions = (auditRows.results || []).map((r) => r.action);
      expect(recordedActions).toEqual([
        "card.created",
        "card.configured",
        "card.deactivated",
        "card.activated",
        "card.archived",
        "card.restored",
      ]);
    });
  });
});
