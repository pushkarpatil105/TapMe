import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import type { AppEnv } from "../types";
import {
  createCard,
  listCards,
  getCardByIdOrToken,
  updateCard,
  generatePublicToken,
  formatCardNumber,
  validateLinksInput,
  sanitizeUrlForAudit,
} from "./cards";
import { createSession, createSessionCookie } from "../auth/session";
import worker from "../index";

const testEnv = env as AppEnv;

let mainAdminId: string;
let staffAdminId: string;
let mainAdminCookie: string;
let staffCookie: string;

beforeEach(async () => {
  mainAdminId = crypto.randomUUID();
  staffAdminId = crypto.randomUUID();

  // Create main_admin
  await testEnv.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role)
     VALUES (?, ?, ?, ?)`
  )
    .bind(mainAdminId, `main_${mainAdminId.slice(0, 8)}`, "hash", "main_admin")
    .run();

  // Create staff
  await testEnv.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role)
     VALUES (?, ?, ?, ?)`
  )
    .bind(staffAdminId, `staff_${staffAdminId.slice(0, 8)}`, "hash", "staff")
    .run();

  const mainSession = await createSession(testEnv, mainAdminId);
  mainAdminCookie = createSessionCookie(testEnv, mainSession.token);

  const staffSession = await createSession(testEnv, staffAdminId);
  staffCookie = createSessionCookie(testEnv, staffSession.token);
});

afterEach(async () => {
  // Clean up test data
  await testEnv.DB.prepare("DELETE FROM scan_events").run();
  await testEnv.DB.prepare("DELETE FROM audit_logs").run();
  await testEnv.DB.prepare("DELETE FROM card_links").run();
  await testEnv.DB.prepare("DELETE FROM cards").run();
  await testEnv.DB.prepare("DELETE FROM sessions").run();
  await testEnv.DB.prepare("DELETE FROM admins WHERE id IN (?, ?)").bind(mainAdminId, staffAdminId).run();
});

describe("Card Number & Token Utilities", () => {
  it("formats sequential card numbers with 3-digit padding", () => {
    expect(formatCardNumber(1)).toBe("001");
    expect(formatCardNumber(42)).toBe("042");
    expect(formatCardNumber(999)).toBe("999");
    expect(formatCardNumber(1005)).toBe("1005");
  });

  it("generates URL-safe cryptographically random public tokens", () => {
    const token1 = generatePublicToken();
    const token2 = generatePublicToken();

    expect(token1).toHaveLength(24);
    expect(token2).toHaveLength(24);
    expect(token1).not.toBe(token2);
    expect(token1).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("Destination Links Validation", () => {
  it("validates valid destination links array", () => {
    const res = validateLinksInput([
      {
        platform: "google_reviews",
        destination_url: "https://g.page/r/test",
      },
      {
        platform: "instagram",
        destination_url: "https://instagram.com/test",
        label: "Follow Us",
        display_order: 1,
        is_enabled: true,
      },
    ]);

    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.links).toHaveLength(2);
      expect(res.links[0].label).toBe("Google Reviews");
      expect(res.links[0].display_order).toBe(0);
      expect(res.links[0].is_enabled).toBe(true);
    }
  });

  it("rejects non-array links", () => {
    const res = validateLinksInput("not-an-array");
    expect(res.valid).toBe(false);
  });

  it("rejects invalid platform", () => {
    const res = validateLinksInput([
      {
        platform: "facebook",
        destination_url: "https://facebook.com",
      },
    ]);
    expect(res.valid).toBe(false);
  });

  it("rejects invalid URLs", () => {
    const res = validateLinksInput([
      {
        platform: "other",
        destination_url: "ftp://example.com",
      },
    ]);
    expect(res.valid).toBe(false);
  });

  it("rejects duplicate destination URLs", () => {
    const res = validateLinksInput([
      {
        platform: "google_reviews",
        destination_url: "https://example.com/page",
      },
      {
        platform: "other",
        destination_url: "https://example.com/page",
      },
    ]);
    expect(res.valid).toBe(false);
  });

  it("rejects duplicate single-platform types", () => {
    const res = validateLinksInput([
      {
        platform: "google_reviews",
        destination_url: "https://example.com/1",
      },
      {
        platform: "google_reviews",
        destination_url: "https://example.com/2",
      },
    ]);
    expect(res.valid).toBe(false);
  });
});

describe("Card Service Operations", () => {
  it("creates a card with sequential number and destination links", async () => {
    const res = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Acme Coffee",
        location: "Downtown",
        qr_type: "all_in_one",
        links: [
          {
            platform: "google_reviews",
            destination_url: "https://g.page/r/acme",
          },
          {
            platform: "whatsapp",
            destination_url: "https://wa.me/1234567890",
            label: "Chat with Us",
          },
        ],
      },
      { business_name: "Acme Coffee", location: "Downtown", qr_type: "all_in_one" }
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.card.card_number).toBeGreaterThanOrEqual(1);
      expect(res.card.formatted_card_number).toMatch(/^\d{3,}$/);
      expect(res.card.business_name).toBe("Acme Coffee");
      expect(res.card.location).toBe("Downtown");
      expect(res.card.status).toBe("active");
      expect(res.card.qr_type).toBe("all_in_one");
      expect(res.card.is_configured).toBe(true);
      expect(res.card.configured_at).toBeTruthy();
      expect(res.card.links).toHaveLength(2);
      expect(res.card.links![0].platform).toBe("google_reviews");
      expect(res.card.links![1].platform).toBe("whatsapp");
    }
  });

  it("rejects card creation when card_number or public_token is provided", async () => {
    const res = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Test", qr_type: "all_in_one" },
      { business_name: "Test", qr_type: "all_in_one", card_number: 999 }
    );

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("cannot be provided");
    }
  });

  it("retrieves a card by number and by public_token", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Flower Shop", location: "Westside", qr_type: "all_in_one" },
      { business_name: "Flower Shop", qr_type: "all_in_one" }
    );

    expect(created.success).toBe(true);
    if (created.success) {
      const byNumber = await getCardByIdOrToken(testEnv, created.card.card_number);
      expect(byNumber).not.toBeNull();
      expect(byNumber!.business_name).toBe("Flower Shop");
      expect(byNumber!.qr_type).toBe("all_in_one");

      const byToken = await getCardByIdOrToken(testEnv, created.card.public_token);
      expect(byToken).not.toBeNull();
      expect(byToken!.card_number).toBe(created.card.card_number);
      expect(byToken!.qr_type).toBe("all_in_one");
    }
  });

  it("updates card fields and preserves existing links when links is omitted", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Bakery",
        qr_type: "instagram",
        links: [
          { platform: "instagram", destination_url: "https://instagram.com/bakery" },
        ],
      },
      { business_name: "Bakery", qr_type: "instagram" }
    );

    expect(created.success).toBe(true);
    if (created.success) {
      const updateRes = await updateCard(
        testEnv,
        created.card.card_number,
        mainAdminId,
        { business_name: "Bakery & Cafe", location: "Uptown" },
        { business_name: "Bakery & Cafe", location: "Uptown" }
      );

      expect(updateRes.success).toBe(true);
      if (updateRes.success) {
        expect(updateRes.card.business_name).toBe("Bakery & Cafe");
        expect(updateRes.card.location).toBe("Uptown");
        expect(updateRes.card.qr_type).toBe("instagram");
        // Existing links should be preserved
        expect(updateRes.card.links).toHaveLength(1);
        expect(updateRes.card.links![0].platform).toBe("instagram");
      }
    }
  });

  it("updates links atomically when new links array is provided", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Bookstore",
        qr_type: "all_in_one",
        links: [
          { platform: "instagram", destination_url: "https://instagram.com/books" },
        ],
      },
      { business_name: "Bookstore", qr_type: "all_in_one" }
    );

    expect(created.success).toBe(true);
    if (created.success) {
      const updateRes = await updateCard(
        testEnv,
        created.card.card_number,
        mainAdminId,
        {
          links: [
            { platform: "google_reviews", destination_url: "https://g.page/r/books" },
            { platform: "whatsapp", destination_url: "https://wa.me/9876543210" },
          ],
        },
        {
          links: [
            { platform: "google_reviews", destination_url: "https://g.page/r/books" },
            { platform: "whatsapp", destination_url: "https://wa.me/9876543210" },
          ],
        }
      );

      expect(updateRes.success).toBe(true);
      if (updateRes.success) {
        expect(updateRes.card.links).toHaveLength(2);
        expect(updateRes.card.links![0].platform).toBe("google_reviews");
        expect(updateRes.card.links![1].platform).toBe("whatsapp");
      }
    }
  });

  it("enforces database trigger preventing direct update to card_number or public_token", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Trigger Test", qr_type: "all_in_one" },
      { business_name: "Trigger Test", qr_type: "all_in_one" }
    );

    expect(created.success).toBe(true);
    if (created.success) {
      await expect(
        testEnv.DB.prepare("UPDATE cards SET card_number = 9999 WHERE public_token = ?")
          .bind(created.card.public_token)
          .run()
      ).rejects.toThrow(/Card number is permanent/);

      await expect(
        testEnv.DB.prepare("UPDATE cards SET public_token = 'new-token' WHERE card_number = ?")
          .bind(created.card.card_number)
          .run()
      ).rejects.toThrow(/Public token is permanent/);
    }
  });
});

describe("Card API Endpoints Integration", () => {
  it("POST /api/cards allows Main Admin to create a card", async () => {
    const request = new Request("http://localhost:8787/api/cards", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        Cookie: mainAdminCookie,
      },
      body: JSON.stringify({
        business_name: "Admin Created Shop",
        location: "Central Mall",
        qr_type: "all_in_one",
      }),
    });

    const response = await worker.fetch(request, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(response.status).toBe(201);
    const json = (await response.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.business_name).toBe("Admin Created Shop");
    expect(json.data.formatted_card_number).toMatch(/^\d{3,}$/);
    expect(json.data.public_token).toBeTruthy();
    expect(json.data.qr_type).toBe("all_in_one");
  });

  it("POST /api/cards allows Staff to create a card", async () => {
    const request = new Request("http://localhost:8787/api/cards", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        Cookie: staffCookie,
      },
      body: JSON.stringify({
        business_name: "Staff Created Shop",
        qr_type: "google_review",
      }),
    });

    const response = await worker.fetch(request, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(response.status).toBe(201);
    const json = (await response.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.business_name).toBe("Staff Created Shop");
    expect(json.data.qr_type).toBe("google_review");
  });

  it("GET /api/cards lists cards newest first", async () => {
    await createCard(
      testEnv,
      mainAdminId,
      { business_name: "First Shop", qr_type: "all_in_one" },
      { business_name: "First Shop", qr_type: "all_in_one" }
    );
    await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Second Shop", qr_type: "all_in_one" },
      { business_name: "Second Shop", qr_type: "all_in_one" }
    );

    const request = new Request("http://localhost:8787/api/cards?page=1&limit=10", {
      method: "GET",
      headers: {
        Cookie: mainAdminCookie,
      },
    });

    const response = await worker.fetch(request, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.cards.length).toBeGreaterThanOrEqual(2);
    // Newest first
    expect(json.data.cards[0].card_number).toBeGreaterThan(
      json.data.cards[1].card_number
    );
    expect(json.data.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("GET /api/cards/:id retrieves card with links", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Detail Shop",
        qr_type: "whatsapp",
        links: [
          { platform: "whatsapp", destination_url: "https://wa.me/5551234" },
        ],
      },
      { business_name: "Detail Shop", qr_type: "whatsapp" }
    );

    expect(created.success).toBe(true);
    if (!created.success) return;

    const request = new Request(
      `http://localhost:8787/api/cards/${created.card.card_number}`,
      {
        method: "GET",
        headers: {
          Cookie: staffCookie,
        },
      }
    );

    const response = await worker.fetch(request, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.business_name).toBe("Detail Shop");
    expect(json.data.links).toHaveLength(1);
    expect(json.data.links[0].platform).toBe("whatsapp");
  });

  it("PATCH /api/cards/:id allows Main Admin to edit a card", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Before Patch", qr_type: "all_in_one" },
      { business_name: "Before Patch", qr_type: "all_in_one" }
    );

    expect(created.success).toBe(true);
    if (!created.success) return;

    const request = new Request(
      `http://localhost:8787/api/cards/${created.card.card_number}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
          Cookie: mainAdminCookie,
        },
        body: JSON.stringify({
          business_name: "After Patch",
          location: "New Location",
        }),
      }
    );

    const response = await worker.fetch(request, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.business_name).toBe("After Patch");
    expect(json.data.location).toBe("New Location");
  });

  it("PATCH /api/cards/:id forbids Staff from editing configured cards with 403", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Staff Cannot Edit",
        qr_type: "all_in_one",
        links: [{ platform: "instagram", destination_url: "https://instagram.com/protected" }],
      },
      {
        business_name: "Staff Cannot Edit",
        qr_type: "all_in_one",
        links: [{ platform: "instagram", destination_url: "https://instagram.com/protected" }],
      }
    );

    expect(created.success).toBe(true);
    if (!created.success) return;

    const request = new Request(
      `http://localhost:8787/api/cards/${created.card.card_number}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
          Cookie: staffCookie,
        },
        body: JSON.stringify({
          business_name: "Hacked by staff",
        }),
      }
    );

    const response = await worker.fetch(request, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(response.status).toBe(403);
    const json = (await response.json()) as any;
    expect(json.error).toMatch(/Staff members are not permitted to edit already-configured cards/i);
  });

  it("PATCH /api/cards/:id rejects attempts to edit card_number or public_token", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Immutable Test", qr_type: "all_in_one" },
      { business_name: "Immutable Test", qr_type: "all_in_one" }
    );

    expect(created.success).toBe(true);
    if (!created.success) return;

    const request = new Request(
      `http://localhost:8787/api/cards/${created.card.card_number}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
          Cookie: mainAdminCookie,
        },
        body: JSON.stringify({
          card_number: 12345,
        }),
      }
    );

    const response = await worker.fetch(request, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(response.status).toBe(400);
    const json = (await response.json()) as any;
    expect(json.error).toContain("card_number, public_token, and qr_type are permanent");
  });
});

describe("Card Lifecycle Management & Filtering", () => {
  it("executes all valid lifecycle transitions correctly", async () => {
    // 1. Newly created card starts as active
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Lifecycle Cafe", qr_type: "all_in_one" },
      { business_name: "Lifecycle Cafe", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    expect(created.card.status).toBe("active");

    const cardId = created.card.card_number;

    // 2. Active -> Inactive (Deactivate)
    const deactReq = new Request(`http://localhost:8787/api/cards/${cardId}/deactivate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const deactRes = await worker.fetch(deactReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(deactRes.status).toBe(200);
    const deactJson = (await deactRes.json()) as any;
    expect(deactJson.data.status).toBe("inactive");

    // 3. Inactive -> Active (Activate)
    const actReq = new Request(`http://localhost:8787/api/cards/${cardId}/activate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const actRes = await worker.fetch(actReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(actRes.status).toBe(200);
    const actJson = (await actRes.json()) as any;
    expect(actJson.data.status).toBe("active");

    // 4. Active -> Archived (Archive)
    const archReq1 = new Request(`http://localhost:8787/api/cards/${cardId}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const archRes1 = await worker.fetch(archReq1, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(archRes1.status).toBe(200);
    const archJson1 = (await archRes1.json()) as any;
    expect(archJson1.data.status).toBe("archived");

    // 5. Archived -> Inactive (Restore) - Rule 5: Restoring an archived card changes status to inactive
    const restReq = new Request(`http://localhost:8787/api/cards/${cardId}/restore`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const restRes = await worker.fetch(restReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(restRes.status).toBe(200);
    const restJson = (await restRes.json()) as any;
    expect(restJson.data.status).toBe("inactive");

    // 6. Inactive -> Archived (Archive)
    const archReq2 = new Request(`http://localhost:8787/api/cards/${cardId}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const archRes2 = await worker.fetch(archReq2, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(archRes2.status).toBe(200);
    const archJson2 = (await archRes2.json()) as any;
    expect(archJson2.data.status).toBe("archived");
  });

  it("rejects invalid status transitions with 400", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Transition Check", qr_type: "all_in_one" },
      { business_name: "Transition Check", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const cardId = created.card.card_number;

    // Card starts as active:
    // A. Activating active card
    const actActiveReq = new Request(`http://localhost:8787/api/cards/${cardId}/activate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const actActiveRes = await worker.fetch(actActiveReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(actActiveRes.status).toBe(400);
    const actActiveJson = (await actActiveRes.json()) as any;
    expect(actActiveJson.error).toContain("already active");

    // B. Restoring active card
    const restActiveReq = new Request(`http://localhost:8787/api/cards/${cardId}/restore`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const restActiveRes = await worker.fetch(restActiveReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(restActiveRes.status).toBe(400);
    const restActiveJson = (await restActiveRes.json()) as any;
    expect(restActiveJson.error).toContain("Only archived cards can be restored");

    // Archive the card
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardId}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // C. Activating archived card directly (Rule 10)
    const actArchReq = new Request(`http://localhost:8787/api/cards/${cardId}/activate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const actArchRes = await worker.fetch(actArchReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(actArchRes.status).toBe(400);
    const actArchJson = (await actArchRes.json()) as any;
    expect(actArchJson.error).toContain("Archived cards cannot be activated directly");

    // D. Deactivating archived card directly
    const deactArchReq = new Request(`http://localhost:8787/api/cards/${cardId}/deactivate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const deactArchRes = await worker.fetch(deactArchReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(deactArchRes.status).toBe(400);

    // E. Archiving an already archived card
    const archArchReq = new Request(`http://localhost:8787/api/cards/${cardId}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const archArchRes = await worker.fetch(archArchReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(archArchRes.status).toBe(400);
    const archArchJson = (await archArchRes.json()) as any;
    expect(archArchJson.error).toContain("already archived");

    // Restore to inactive
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardId}/restore`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // F. Deactivating inactive card
    const deactInactReq = new Request(`http://localhost:8787/api/cards/${cardId}/deactivate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const deactInactRes = await worker.fetch(deactInactReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(deactInactRes.status).toBe(400);
    const deactInactJson = (await deactInactRes.json()) as any;
    expect(deactInactJson.error).toContain("already inactive");

    // G. Restoring inactive card
    const restInactReq = new Request(`http://localhost:8787/api/cards/${cardId}/restore`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    });
    const restInactRes = await worker.fetch(restInactReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(restInactRes.status).toBe(400);
  });

  it("prevents editing an archived card until it is restored (Rule 6)", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Original Name", qr_type: "all_in_one" },
      { business_name: "Original Name", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const cardId = created.card.card_number;

    // Archive the card
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardId}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Attempt to PATCH archived card
    const patchReq = new Request(`http://localhost:8787/api/cards/${cardId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        Cookie: mainAdminCookie,
      },
      body: JSON.stringify({ business_name: "Modified Name" }),
    });
    const patchRes = await worker.fetch(patchReq, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(patchRes.status).toBe(400);
    const patchJson = (await patchRes.json()) as any;
    expect(patchJson.error).toContain("Archived cards cannot be edited");

    // Restore the card
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardId}/restore`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Now PATCH should succeed
    const patchReq2 = new Request(`http://localhost:8787/api/cards/${cardId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        Cookie: mainAdminCookie,
      },
      body: JSON.stringify({ business_name: "Restored And Modified" }),
    });
    const patchRes2 = await worker.fetch(patchReq2, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(patchRes2.status).toBe(200);
    const patchJson2 = (await patchRes2.json()) as any;
    expect(patchJson2.data.business_name).toBe("Restored And Modified");
  });

  it("enforces staff authorization restrictions across lifecycle endpoints", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Staff Permissions Test", qr_type: "all_in_one" },
      { business_name: "Staff Permissions Test", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const cardId = created.card.card_number;

    // Staff cannot deactivate
    const deactRes = await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardId}/deactivate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: staffCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(deactRes.status).toBe(403);

    // Staff cannot activate
    const actRes = await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardId}/activate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: staffCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(actRes.status).toBe(403);

    // Staff cannot archive
    const archRes = await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardId}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: staffCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(archRes.status).toBe(403);

    // Staff cannot restore
    const restRes = await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardId}/restore`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: staffCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(restRes.status).toBe(403);

    // Archive card as main admin
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardId}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Staff cannot fetch archived card directly (GET /api/cards/:id)
    const getArchRes = await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardId}`, {
      method: "GET",
      headers: { Cookie: staffCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(getArchRes.status).toBe(403);
    const getArchJson = (await getArchRes.json()) as any;
    expect(getArchJson.error).toContain("Staff members are not permitted to view archived cards");

    // Staff cannot list archived cards (GET /api/cards?status=archived)
    const listArchRes = await worker.fetch(new Request("http://localhost:8787/api/cards?status=archived", {
      method: "GET",
      headers: { Cookie: staffCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(listArchRes.status).toBe(403);
    const listArchJson = (await listArchRes.json()) as any;
    expect(listArchJson.error).toContain("Staff members are not permitted to view archived cards");
  });

  it("filters cards by status and excludes archived cards by default", async () => {
    // Create 3 cards: 1 active, 1 inactive, 1 archived
    const card1 = await createCard(testEnv, mainAdminId, { business_name: "Active Card", qr_type: "all_in_one" }, { business_name: "Active Card", qr_type: "all_in_one" });
    const card2 = await createCard(testEnv, mainAdminId, { business_name: "Inactive Card", qr_type: "all_in_one" }, { business_name: "Inactive Card", qr_type: "all_in_one" });
    const card3 = await createCard(testEnv, mainAdminId, { business_name: "Archived Card", qr_type: "all_in_one" }, { business_name: "Archived Card", qr_type: "all_in_one" });

    if (!card1.success || !card2.success || !card3.success) return;

    // Set card2 to inactive
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${card2.card.card_number}/deactivate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Set card3 to archived
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${card3.card.card_number}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Default GET /api/cards: returns active and inactive, excludes archived
    const defaultRes = await worker.fetch(new Request("http://localhost:8787/api/cards", {
      method: "GET",
      headers: { Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(defaultRes.status).toBe(200);
    const defaultJson = (await defaultRes.json()) as any;
    const defaultStatuses = defaultJson.data.cards.map((c: any) => c.status);
    expect(defaultStatuses).toContain("active");
    expect(defaultStatuses).toContain("inactive");
    expect(defaultStatuses).not.toContain("archived");

    // GET /api/cards?status=active: returns only active
    const activeRes = await worker.fetch(new Request("http://localhost:8787/api/cards?status=active", {
      method: "GET",
      headers: { Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(activeRes.status).toBe(200);
    const activeJson = (await activeRes.json()) as any;
    expect(activeJson.data.cards.every((c: any) => c.status === "active")).toBe(true);
    expect(activeJson.data.cards.some((c: any) => c.card_number === card1.card.card_number)).toBe(true);

    // GET /api/cards?status=inactive: returns only inactive
    const inactiveRes = await worker.fetch(new Request("http://localhost:8787/api/cards?status=inactive", {
      method: "GET",
      headers: { Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(inactiveRes.status).toBe(200);
    const inactiveJson = (await inactiveRes.json()) as any;
    expect(inactiveJson.data.cards.every((c: any) => c.status === "inactive")).toBe(true);
    expect(inactiveJson.data.cards.some((c: any) => c.card_number === card2.card.card_number)).toBe(true);

    // GET /api/cards?status=archived: returns only archived for Main Admin
    const archivedRes = await worker.fetch(new Request("http://localhost:8787/api/cards?status=archived", {
      method: "GET",
      headers: { Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(archivedRes.status).toBe(200);
    const archivedJson = (await archivedRes.json()) as any;
    expect(archivedJson.data.cards.every((c: any) => c.status === "archived")).toBe(true);
    expect(archivedJson.data.cards.some((c: any) => c.card_number === card3.card.card_number)).toBe(true);

    // GET /api/cards?status=invalid: returns 400
    const invalidRes = await worker.fetch(new Request("http://localhost:8787/api/cards?status=invalid_status", {
      method: "GET",
      headers: { Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
    expect(invalidRes.status).toBe(400);
  });

  it("preserves destination links and historical scan events across lifecycle changes", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Preserved Enterprise",
        qr_type: "all_in_one",
        links: [
          { platform: "google_reviews", destination_url: "https://g.page/r/test", is_enabled: true },
          { platform: "instagram", destination_url: "https://instagram.com/preserved", is_enabled: true },
        ],
      },
      { business_name: "Preserved Enterprise", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const cardNum = created.card.card_number;

    // Insert historical scan event
    await testEnv.DB.prepare(
      `INSERT INTO scan_events (id, card_number, scanned_at, user_agent, referrer)
       VALUES (?, ?, CURRENT_TIMESTAMP, 'TestBrowser', 'https://qr.test')`
    ).bind(crypto.randomUUID(), cardNum).run();

    // Deactivate card
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardNum}/deactivate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Archive card
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardNum}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Restore card
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardNum}/restore`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Verify card links are preserved intact
    const cardLinks = await testEnv.DB.prepare(
      "SELECT platform, destination_url, is_enabled FROM card_links WHERE card_number = ?"
    ).bind(cardNum).all<{ platform: string; destination_url: string; is_enabled: number }>();
    expect(cardLinks.results).toHaveLength(2);
    expect(cardLinks.results.every((l) => l.is_enabled === 1)).toBe(true);

    // Verify scan event is preserved intact
    const scanEvents = await testEnv.DB.prepare(
      "SELECT id, card_number, user_agent FROM scan_events WHERE card_number = ?"
    ).bind(cardNum).all<{ id: string; card_number: number; user_agent: string }>();
    expect(scanEvents.results).toHaveLength(1);
    expect(scanEvents.results[0].user_agent).toBe("TestBrowser");
  });

  it("creates accurate audit log records atomically for each lifecycle action", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Audit Test Corp", qr_type: "all_in_one" },
      { business_name: "Audit Test Corp", qr_type: "all_in_one" }
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const cardNum = created.card.card_number;

    // 1. Deactivate
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardNum}/deactivate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // 2. Activate
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardNum}/activate`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // 3. Archive
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardNum}/archive`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // 4. Restore
    await worker.fetch(new Request(`http://localhost:8787/api/cards/${cardNum}/restore`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
    }), testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any);

    // Verify audit_logs table
    const logs = await testEnv.DB.prepare(
      `SELECT action, entity_type, entity_id, admin_id, details
       FROM audit_logs
       WHERE entity_id = ?
       ORDER BY created_at ASC, rowid ASC`
    ).bind(String(cardNum)).all<{
      action: string;
      entity_type: string;
      entity_id: string;
      admin_id: string;
      details: string;
    }>();

    expect(logs.results).toHaveLength(5);

    const [createdLog, deactLog, actLog, archLog, restLog] = logs.results;

    expect(createdLog.action).toBe("card.created");
    expect(createdLog.admin_id).toBe(mainAdminId);
    expect(createdLog.entity_type).toBe("card");
    const createdDetails = JSON.parse(createdLog.details);
    expect(createdDetails.business_name).toBe("Audit Test Corp");
    expect(createdDetails.card_number).toBe(cardNum);

    expect(deactLog.action).toBe("card.deactivated");
    expect(deactLog.admin_id).toBe(mainAdminId);
    expect(deactLog.entity_type).toBe("card");
    const deactDetails = JSON.parse(deactLog.details);
    expect(deactDetails.previous_status).toBe("active");
    expect(deactDetails.new_status).toBe("inactive");
    expect(deactDetails.card_number).toBe(cardNum);

    expect(actLog.action).toBe("card.activated");
    const actDetails = JSON.parse(actLog.details);
    expect(actDetails.previous_status).toBe("inactive");
    expect(actDetails.new_status).toBe("active");

    expect(archLog.action).toBe("card.archived");
    const archDetails = JSON.parse(archLog.details);
    expect(archDetails.previous_status).toBe("active");
    expect(archDetails.new_status).toBe("archived");

    expect(restLog.action).toBe("card.restored");
    const restDetails = JSON.parse(restLog.details);
    expect(restDetails.previous_status).toBe("archived");
    expect(restDetails.new_status).toBe("inactive");
  });

  describe("Card Audit Logging (Phase 6.1)", () => {
    it("creates an audit event atomically on successful card creation", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Audit Logging Artisan",
          location: "Suite 404",
          qr_type: "all_in_one",
          links: [
            { platform: "google_reviews", destination_url: "https://g.page/r/artisan" },
            { platform: "whatsapp", destination_url: "https://wa.me/1234567890" },
          ],
        },
        {
          business_name: "Audit Logging Artisan",
          location: "Suite 404",
          qr_type: "all_in_one",
          links: [
            { platform: "google_reviews", destination_url: "https://g.page/r/artisan" },
            { platform: "whatsapp", destination_url: "https://wa.me/1234567890" },
          ],
        }
      );

      expect(created.success).toBe(true);
      if (!created.success) return;

      const log = await testEnv.DB.prepare(
        `SELECT id, admin_id, action, entity_type, entity_id, details, created_at
         FROM audit_logs
         WHERE entity_id = ? AND action = 'card.created'`
      )
        .bind(String(created.card.card_number))
        .first<{
          id: string;
          admin_id: string;
          action: string;
          entity_type: string;
          entity_id: string;
          details: string;
          created_at: string;
        }>();

      expect(log).not.toBeNull();
      if (!log) return;

      expect(log.action).toBe("card.created");
      expect(log.admin_id).toBe(mainAdminId);
      expect(log.entity_type).toBe("card");
      expect(log.entity_id).toBe(String(created.card.card_number));
      expect(log.created_at).toBeTruthy();

      const details = JSON.parse(log.details);
      expect(details.card_number).toBe(created.card.card_number);
      expect(details.public_token).toBeUndefined();
      expect(details.business_name).toBe("Audit Logging Artisan");
      expect(details.location).toBe("Suite 404");
      expect(details.qr_type).toBe("all_in_one");
      expect(details.is_configured).toBe(true);
      expect(details.links_count).toBe(2);
      expect(details.links).toHaveLength(2);
      expect(details.links[0].platform).toBe("google_reviews");
      expect(details.links[1].platform).toBe("whatsapp");
    });

    it("does not write an audit event when card creation fails validation", async () => {
      const beforeCount = await testEnv.DB.prepare(
        "SELECT count(*) as count FROM audit_logs"
      ).first<{ count: number }>();

      const failedRes = await createCard(
        testEnv,
        mainAdminId,
        { business_name: "", qr_type: "all_in_one" },
        { business_name: "", qr_type: "all_in_one" }
      );

      expect(failedRes.success).toBe(false);

      const afterCount = await testEnv.DB.prepare(
        "SELECT count(*) as count FROM audit_logs"
      ).first<{ count: number }>();

      expect(afterCount?.count).toBe(beforeCount?.count);
    });

    it("creates a card.updated audit event capturing changed fields and before/after values", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Original Name",
          location: "Original Location",
          qr_type: "all_in_one",
          links: [{ platform: "google_reviews", destination_url: "https://g.page/r/orig" }],
        },
        {
          business_name: "Original Name",
          location: "Original Location",
          qr_type: "all_in_one",
          links: [{ platform: "google_reviews", destination_url: "https://g.page/r/orig" }],
        }
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const updateRes = await updateCard(
        testEnv,
        created.card.card_number,
        mainAdminId,
        {
          business_name: "Updated Name",
          location: "New Uptown Suite",
          links: [
            { platform: "google_reviews", destination_url: "https://g.page/r/updated" },
            { platform: "instagram", destination_url: "https://instagram.com/brand" },
          ],
        },
        {
          business_name: "Updated Name",
          location: "New Uptown Suite",
          links: [
            { platform: "google_reviews", destination_url: "https://g.page/r/updated" },
            { platform: "instagram", destination_url: "https://instagram.com/brand" },
          ],
        }
      );

      expect(updateRes.success).toBe(true);

      const updateLog = await testEnv.DB.prepare(
        `SELECT action, entity_type, entity_id, admin_id, details
         FROM audit_logs
         WHERE entity_id = ? AND action = 'card.updated'`
      )
        .bind(String(created.card.card_number))
        .first<{
          action: string;
          entity_type: string;
          entity_id: string;
          admin_id: string;
          details: string;
        }>();

      expect(updateLog).not.toBeNull();
      if (!updateLog) return;

      expect(updateLog.action).toBe("card.updated");
      expect(updateLog.entity_type).toBe("card");
      expect(updateLog.entity_id).toBe(String(created.card.card_number));
      expect(updateLog.admin_id).toBe(mainAdminId);

      const details = JSON.parse(updateLog.details);
      expect(details.card_number).toBe(created.card.card_number);
      expect(details.public_token).toBeUndefined();
      expect(details.changed_fields).toEqual(["business_name", "location", "links"]);

      expect(details.changes.business_name).toEqual({
        before: "Original Name",
        after: "Updated Name",
      });
      expect(details.changes.location).toEqual({
        before: "Original Location",
        after: "New Uptown Suite",
      });
      expect(details.changes.links.before).toHaveLength(1);
      expect(details.changes.links.after).toHaveLength(2);
    });

    it("does not create an audit event when update is a no-op", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Stable Business",
          location: "Same Place",
          qr_type: "google_review",
          links: [{ platform: "google_reviews", destination_url: "https://g.page/r/stable" }],
        },
        {
          business_name: "Stable Business",
          location: "Same Place",
          qr_type: "google_review",
          links: [{ platform: "google_reviews", destination_url: "https://g.page/r/stable" }],
        }
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const countBefore = await testEnv.DB.prepare(
        "SELECT count(*) as count FROM audit_logs WHERE entity_id = ? AND action = 'card.updated'"
      )
        .bind(String(created.card.card_number))
        .first<{ count: number }>();
      expect(countBefore?.count).toBe(0);

      // Perform no-op update with identical fields
      const noOpRes = await updateCard(
        testEnv,
        created.card.card_number,
        mainAdminId,
        {
          business_name: "Stable Business",
          location: "Same Place",
          links: [{ platform: "google_reviews", destination_url: "https://g.page/r/stable" }],
        },
        {
          business_name: "Stable Business",
          location: "Same Place",
          links: [{ platform: "google_reviews", destination_url: "https://g.page/r/stable" }],
        }
      );

      expect(noOpRes.success).toBe(true);

      const countAfter = await testEnv.DB.prepare(
        "SELECT count(*) as count FROM audit_logs WHERE entity_id = ? AND action = 'card.updated'"
      )
        .bind(String(created.card.card_number))
        .first<{ count: number }>();

      expect(countAfter?.count).toBe(0);
    });

    it("forbids staff from updating cards and writes zero audit events", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Protected From Staff",
          qr_type: "all_in_one",
          links: [{ platform: "google_reviews", destination_url: "https://g.page/r/protected" }],
        },
        {
          business_name: "Protected From Staff",
          qr_type: "all_in_one",
          links: [{ platform: "google_reviews", destination_url: "https://g.page/r/protected" }],
        }
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const req = new Request(
        `http://localhost:8787/api/cards/${created.card.card_number}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({ business_name: "Hacked Title" }),
        }
      );

      const res = await worker.fetch(req, testEnv, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(403);

      const auditCount = await testEnv.DB.prepare(
        "SELECT count(*) as count FROM audit_logs WHERE entity_id = ? AND action = 'card.updated'"
      )
        .bind(String(created.card.card_number))
        .first<{ count: number }>();

      expect(auditCount?.count).toBe(0);
    });

    it("sanitizeUrlForAudit strips query parameters and fragments while preserving origin and pathname", () => {
      expect(sanitizeUrlForAudit("https://wa.me/1234567890?text=SecretCode")).toBe("https://wa.me/1234567890");
      expect(sanitizeUrlForAudit("https://instagram.com/brand?access_token=ya29.xyz#profile")).toBe("https://instagram.com/brand");
      expect(sanitizeUrlForAudit("https://g.page/r/artisan?trk=123")).toBe("https://g.page/r/artisan");
      expect(sanitizeUrlForAudit("https://example.com/some/path?foo=bar#target")).toBe("https://example.com/some/path");
      expect(sanitizeUrlForAudit("")).toBe("");
    });

    it("redacts public_token and sensitive URL query parameters/fragments from card.created audit details", async () => {
      const sensitiveUrl = "https://g.page/r/artisan?auth_token=supersecret123&utm_source=fb#review-modal";
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Redaction Test Card",
          location: "Security Room",
          qr_type: "google_review",
          links: [{ platform: "google_reviews", destination_url: sensitiveUrl }],
        },
        {
          business_name: "Redaction Test Card",
          location: "Security Room",
          qr_type: "google_review",
          links: [{ platform: "google_reviews", destination_url: sensitiveUrl }],
        }
      );

      expect(created.success).toBe(true);
      if (!created.success) return;

      const log = await testEnv.DB.prepare(
        `SELECT details FROM audit_logs WHERE entity_id = ? AND action = 'card.created'`
      )
        .bind(String(created.card.card_number))
        .first<{ details: string }>();

      expect(log).not.toBeNull();
      if (!log) return;

      const details = JSON.parse(log.details);

      // 1. Verify public_token is not in audit details
      expect(details.public_token).toBeUndefined();
      expect(log.details).not.toContain(created.card.public_token);

      // 2. Verify sensitive URL query parameters and fragments are not in audit details
      expect(details.links[0].destination_url).toBe("https://g.page/r/artisan");
      expect(log.details).not.toContain("supersecret123");
      expect(log.details).not.toContain("utm_source=fb");
      expect(log.details).not.toContain("review-modal");

      // 3. Verify useful audit fields are preserved
      expect(details.card_number).toBe(created.card.card_number);
      expect(details.business_name).toBe("Redaction Test Card");
      expect(details.location).toBe("Security Room");
      expect(details.qr_type).toBe("google_review");
      expect(details.links[0].platform).toBe("google_reviews");
      expect(details.links[0].label).toBe("Google Reviews");
      expect(details.links[0].is_enabled).toBe(true);
      expect(details.links[0].display_order).toBe(0);

      // 4. Verify that the actual card link in the database preserves full URL for operational redirects
      const dbLink = await testEnv.DB.prepare(
        `SELECT destination_url FROM card_links WHERE card_number = ?`
      )
        .bind(created.card.card_number)
        .first<{ destination_url: string }>();

      expect(dbLink?.destination_url).toBe(sensitiveUrl);
    });

    it("redacts public_token and sensitive URL query parameters/fragments from card.updated audit details", async () => {
      const initialUrl = "https://g.page/r/initial?session=init123#head";
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Original Secret Card",
          qr_type: "all_in_one",
          links: [{ platform: "google_reviews", destination_url: initialUrl }],
        },
        {
          business_name: "Original Secret Card",
          qr_type: "all_in_one",
          links: [{ platform: "google_reviews", destination_url: initialUrl }],
        }
      );

      expect(created.success).toBe(true);
      if (!created.success) return;

      const updatedUrl = "https://instagram.com/mybrand?access_token=secretUpdate789&trk=ad#feed";
      const updateRes = await updateCard(
        testEnv,
        created.card.card_number,
        mainAdminId,
        {
          links: [{ platform: "instagram", destination_url: updatedUrl }],
        },
        {
          links: [{ platform: "instagram", destination_url: updatedUrl }],
        }
      );

      expect(updateRes.success).toBe(true);

      const log = await testEnv.DB.prepare(
        `SELECT details FROM audit_logs WHERE entity_id = ? AND action = 'card.updated'`
      )
        .bind(String(created.card.card_number))
        .first<{ details: string }>();

      expect(log).not.toBeNull();
      if (!log) return;

      const details = JSON.parse(log.details);

      // 1. Verify public_token is not in audit details
      expect(details.public_token).toBeUndefined();
      expect(log.details).not.toContain(created.card.public_token);

      // 2. Verify before and after snapshots have sanitized URLs without tokens or fragments
      expect(details.changes.links.before[0].destination_url).toBe("https://g.page/r/initial");
      expect(details.changes.links.after[0].destination_url).toBe("https://instagram.com/mybrand");
      expect(log.details).not.toContain("init123");
      expect(log.details).not.toContain("secretUpdate789");
      expect(log.details).not.toContain("trk=ad");
      expect(log.details).not.toContain("feed");

      // 3. Verify useful metadata in before/after snapshots is preserved
      expect(details.changes.links.before[0].platform).toBe("google_reviews");
      expect(details.changes.links.after[0].platform).toBe("instagram");
      expect(details.changes.links.after[0].is_enabled).toBe(true);

      // 4. Verify database preserves full destination URL for actual redirect handling
      const dbLink = await testEnv.DB.prepare(
        `SELECT destination_url FROM card_links WHERE card_number = ?`
      )
        .bind(created.card.card_number)
        .first<{ destination_url: string }>();

      expect(dbLink?.destination_url).toBe(updatedUrl);
    });
  });

  describe("Preprinted Cards & QR Types (Phase 2A)", () => {
    it("creates preprinted cards with zero links for all 4 QR types, setting configured_at=null and is_configured=false", async () => {
      const qrTypes = ["google_review", "instagram", "whatsapp", "all_in_one"] as const;

      for (const qrType of qrTypes) {
        const res = await worker.fetch(
          new Request("http://localhost:8787/api/cards", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "http://localhost:5173",
              Cookie: mainAdminCookie,
            },
            body: JSON.stringify({
              business_name: `Preprinted ${qrType}`,
              qr_type: qrType,
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
        expect(json.data.links).toEqual([]);
        expect(json.data.status).toBe("active");
        expect(json.data.public_token).toHaveLength(24);

        // Verify retrieval via GET /api/cards/:id
        const getRes = await worker.fetch(
          new Request(`http://localhost:8787/api/cards/${json.data.card_number}`, {
            method: "GET",
            headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
          }),
          testEnv,
          { waitUntil: () => {}, passThroughOnException: () => {} } as any
        );
        expect(getRes.status).toBe(200);
        const getJson = (await getRes.json()) as any;
        expect(getJson.data.qr_type).toBe(qrType);
        expect(getJson.data.configured_at).toBeNull();
        expect(getJson.data.is_configured).toBe(false);

        // Verify retrieval in card list
        const listRes = await worker.fetch(
          new Request("http://localhost:8787/api/cards", {
            method: "GET",
            headers: { Origin: "http://localhost:5173", Cookie: mainAdminCookie },
          }),
          testEnv,
          { waitUntil: () => {}, passThroughOnException: () => {} } as any
        );
        expect(listRes.status).toBe(200);
        const listJson = (await listRes.json()) as any;
        const found = listJson.data.cards.find((c: any) => c.card_number === json.data.card_number);
        expect(found).toBeDefined();
        expect(found.qr_type).toBe(qrType);
        expect(found.configured_at).toBeNull();
        expect(found.is_configured).toBe(false);
      }
    });

    it("creates single-purpose cards with matching initial destination link and stamps configured_at", async () => {
      const singlePurposeConfigs = [
        {
          qr_type: "google_review",
          link: { platform: "google_reviews", destination_url: "https://g.page/r/my-biz" },
        },
        {
          qr_type: "instagram",
          link: { platform: "instagram", destination_url: "https://instagram.com/my_biz" },
        },
        {
          qr_type: "whatsapp",
          link: { platform: "whatsapp", destination_url: "https://wa.me/1234567890" },
        },
      ] as const;

      for (const config of singlePurposeConfigs) {
        const res = await worker.fetch(
          new Request("http://localhost:8787/api/cards", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "http://localhost:5173",
              Cookie: mainAdminCookie,
            },
            body: JSON.stringify({
              business_name: `Configured ${config.qr_type}`,
              qr_type: config.qr_type,
              links: [config.link],
            }),
          }),
          testEnv,
          { waitUntil: () => {}, passThroughOnException: () => {} } as any
        );

        expect(res.status).toBe(201);
        const json = (await res.json()) as any;
        expect(json.success).toBe(true);
        expect(json.data.qr_type).toBe(config.qr_type);
        expect(json.data.configured_at).not.toBeNull();
        expect(typeof json.data.configured_at).toBe("string");
        expect(json.data.is_configured).toBe(true);
        expect(json.data.links).toHaveLength(1);
        expect(json.data.links[0].platform).toBe(config.link.platform);
      }
    });

    it("rejects card creation when qr_type is missing or invalid", async () => {
      // 1. Missing qr_type
      const missingRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Missing QR Type",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(missingRes.status).toBe(400);
      const missingJson = (await missingRes.json()) as any;
      expect(missingJson.success).toBe(false);
      expect(missingJson.error).toMatch(/qr_type is required/i);

      // 2. Invalid qr_type
      const invalidRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Invalid QR Type",
            qr_type: "twitter",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(invalidRes.status).toBe(400);
      const invalidJson = (await invalidRes.json()) as any;
      expect(invalidJson.success).toBe(false);
      expect(invalidJson.error).toMatch(/Allowed values/i);
    });

    it("enforces platform matching rules for single-purpose cards", async () => {
      // 1. google_review rejects instagram link
      const grRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Mismatch GR",
            qr_type: "google_review",
            links: [{ platform: "instagram", destination_url: "https://instagram.com/biz" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(grRes.status).toBe(400);
      const grJson = (await grRes.json()) as any;
      expect(grJson.error).toContain("google_reviews");

      // 2. instagram rejects whatsapp link
      const igRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Mismatch IG",
            qr_type: "instagram",
            links: [{ platform: "whatsapp", destination_url: "https://wa.me/1234567890" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(igRes.status).toBe(400);
      const igJson = (await igRes.json()) as any;
      expect(igJson.error).toContain("instagram");

      // 3. whatsapp rejects other link
      const waRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Mismatch WA",
            qr_type: "whatsapp",
            links: [{ platform: "other", destination_url: "https://example.com" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(waRes.status).toBe(400);
      const waJson = (await waRes.json()) as any;
      expect(waJson.error).toContain("whatsapp");
    });

    it("rejects multiple links for single-purpose cards", async () => {
      const res = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Multi-link GR",
            qr_type: "google_review",
            links: [
              { platform: "google_reviews", destination_url: "https://g.page/r/one" },
              { platform: "other", destination_url: "https://example.com/two" },
            ],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.error).toContain("at most 1 destination link");
    });

    it("allows all_in_one cards to have up to 20 links across all supported platforms", async () => {
      const links = [
        { platform: "google_reviews", destination_url: "https://g.page/r/review", label: "Google Review" },
        { platform: "instagram", destination_url: "https://instagram.com/profile", label: "Instagram" },
        { platform: "whatsapp", destination_url: "https://wa.me/1234567890", label: "WhatsApp" },
        ...Array.from({ length: 17 }, (_, i) => ({
          platform: "other" as const,
          destination_url: `https://example.com/dest/${i}`,
          label: `Other ${i + 1}`,
        })),
      ];

      const res = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Full All In One",
            qr_type: "all_in_one",
            links,
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(res.status).toBe(201);
      const json = (await res.json()) as any;
      expect(json.data.links).toHaveLength(20);
      expect(json.data.is_configured).toBe(true);

      // Exceeding 20 links rejected
      const tooManyLinks = Array.from({ length: 21 }, (_, i) => ({
        platform: "other",
        destination_url: `https://example.com/dest/${i}`,
      }));

      const exceedRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Over Limit",
            qr_type: "all_in_one",
            links: tooManyLinks,
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(exceedRes.status).toBe(400);
    });

    it("rejects invalid destination URLs during card creation", async () => {
      const invalidUrlRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "XSS Attempt",
            qr_type: "google_review",
            links: [{ platform: "google_reviews", destination_url: "javascript:alert(1)" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(invalidUrlRes.status).toBe(400);
      const json = (await invalidUrlRes.json()) as any;
      expect(json.error).toMatch(/valid http\/https destination_url/i);
    });

    it("prevents changing qr_type after card creation (immutable qr_type)", async () => {
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Fixed Type Card",
            qr_type: "google_review",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(createRes.status).toBe(201);
      const card = (await createRes.json() as any).data;

      // Attempt to change qr_type via PATCH
      const patchRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            qr_type: "instagram",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(patchRes.status).toBe(400);
      const patchJson = (await patchRes.json()) as any;
      expect(patchJson.error).toMatch(/permanent and cannot be modified/i);

      // Verify DB record remained unchanged
      const dbRow = await testEnv.DB.prepare("SELECT qr_type FROM cards WHERE card_number = ?")
        .bind(card.card_number)
        .first<{ qr_type: string }>();
      expect(dbRow?.qr_type).toBe("google_review");
    });

    it("stamps configured_at when an unconfigured card receives links and preserves it on subsequent updates", async () => {
      // 1. Create unconfigured card
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Awaiting Client",
            qr_type: "all_in_one",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(createRes.status).toBe(201);
      const card = (await createRes.json() as any).data;
      expect(card.configured_at).toBeNull();
      expect(card.is_configured).toBe(false);

      // 2. Configure card for client
      const patchRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            links: [{ platform: "instagram", destination_url: "https://instagram.com/client" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(patchRes.status).toBe(200);
      const patchedCard = (await patchRes.json() as any).data;
      expect(patchedCard.configured_at).not.toBeNull();
      expect(patchedCard.is_configured).toBe(true);
      const initialConfiguredAt = patchedCard.configured_at;

      // 3. Subsequent update preserves initial configured_at timestamp
      const patchAgainRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Client Brand Updated",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(patchAgainRes.status).toBe(200);
      const patchedAgainCard = (await patchAgainRes.json() as any).data;
      expect(patchedAgainCard.configured_at).toBe(initialConfiguredAt);
      expect(patchedAgainCard.is_configured).toBe(true);
    });

    it("enforces card qr_type constraints when updating destination links later", async () => {
      // Create unconfigured whatsapp card
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "WhatsApp Shop",
            qr_type: "whatsapp",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = (await createRes.json() as any).data;

      // Try updating with google_reviews link: must fail
      const badLinkRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            links: [{ platform: "google_reviews", destination_url: "https://g.page/r/test" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(badLinkRes.status).toBe(400);

      // Update with valid whatsapp link: succeeds
      const goodLinkRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            links: [{ platform: "whatsapp", destination_url: "https://wa.me/1234567890" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(goodLinkRes.status).toBe(200);
    });

    it("records qr_type and is_configured in card.created audit logs", async () => {
      // 1. Zero-link card
      const unconfRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Audit Zero Link",
            qr_type: "whatsapp",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(unconfRes.status).toBe(201);
      const unconfCard = (await unconfRes.json() as any).data;

      const unconfLog = await testEnv.DB.prepare(
        "SELECT details FROM audit_logs WHERE entity_id = ? AND action = 'card.created'"
      ).bind(String(unconfCard.card_number)).first<{ details: string }>();

      expect(unconfLog).not.toBeNull();
      const unconfDetails = JSON.parse(unconfLog!.details);
      expect(unconfDetails.qr_type).toBe("whatsapp");
      expect(unconfDetails.is_configured).toBe(false);
      expect(unconfDetails.links_count).toBe(0);

      // 2. Configured card
      const confRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Audit With Link",
            qr_type: "google_review",
            links: [{ platform: "google_reviews", destination_url: "https://g.page/r/audit-test" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(confRes.status).toBe(201);
      const confCard = (await confRes.json() as any).data;

      const confLog = await testEnv.DB.prepare(
        "SELECT details FROM audit_logs WHERE entity_id = ? AND action = 'card.created'"
      ).bind(String(confCard.card_number)).first<{ details: string }>();

      expect(confLog).not.toBeNull();
      const confDetails = JSON.parse(confLog!.details);
      expect(confDetails.qr_type).toBe("google_review");
      expect(confDetails.is_configured).toBe(true);
      expect(confDetails.links_count).toBe(1);
    });

    it("rolls back card creation atomically if a batch operation fails", async () => {
      // Mock DB.batch to simulate mid-batch failure
      const originalBatch = testEnv.DB.batch.bind(testEnv.DB);
      let batchCallCount = 0;
      testEnv.DB.batch = (async (statements: any) => {
        batchCallCount++;
        throw new Error("Simulated D1 batch failure");
      }) as any;

      try {
        const result = await createCard(
          testEnv,
          mainAdminId,
          {
            business_name: "Atomic Rollback Test",
            qr_type: "all_in_one",
          },
          { business_name: "Atomic Rollback Test", qr_type: "all_in_one" }
        );
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toMatch(/Database error while creating card/i);
        }
      } finally {
        testEnv.DB.batch = originalBatch;
      }

      // Verify no card was inserted
      const count = await testEnv.DB.prepare(
        "SELECT count(*) as count FROM cards WHERE business_name = 'Atomic Rollback Test'"
      ).first<{ count: number }>();
      expect(count?.count).toBe(0);
    });

    it("enforces database trigger prevent_qr_type_update on direct SQL updates", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        { business_name: "Trigger QR Test", qr_type: "google_review" },
        { business_name: "Trigger QR Test", qr_type: "google_review" }
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      await expect(
        testEnv.DB.prepare("UPDATE cards SET qr_type = 'instagram' WHERE card_number = ?")
          .bind(created.card.card_number)
          .run()
      ).rejects.toThrow(/QR type is permanent and cannot be changed/i);

      // Verify db value remained unchanged
      const row = await testEnv.DB.prepare("SELECT qr_type FROM cards WHERE card_number = ?")
        .bind(created.card.card_number)
        .first<{ qr_type: string }>();
      expect(row?.qr_type).toBe("google_review");
    });
  });

  describe("Staff One-Time Card Configuration (Phase 2B)", () => {
    it("allows staff to create a preprinted card with any supported immutable qr_type", async () => {
      const qrTypes = ["google_review", "instagram", "whatsapp", "all_in_one"] as const;

      for (const qrType of qrTypes) {
        const res = await worker.fetch(
          new Request("http://localhost:8787/api/cards", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "http://localhost:5173",
              Cookie: staffCookie,
            },
            body: JSON.stringify({
              business_name: `Staff Batch ${qrType}`,
              qr_type: qrType,
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
        expect(json.data.links).toEqual([]);
        expect(json.data.created_by).toBe(staffAdminId);
      }
    });

    it("allows staff to view and generate QR codes without consuming the configuration allowance", async () => {
      // 1. Staff creates unconfigured card
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Preprinted Inventory Item",
            qr_type: "google_review",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(createRes.status).toBe(201);
      const card = (await createRes.json() as any).data;
      expect(card.configured_at).toBeNull();
      expect(card.is_configured).toBe(false);

      // 2. Staff views card details via GET /api/cards/:id to generate QR payload
      const viewRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "GET",
          headers: { Origin: "http://localhost:5173", Cookie: staffCookie },
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(viewRes.status).toBe(200);
      const viewCard = (await viewRes.json() as any).data;
      expect(viewCard.public_token).toHaveLength(24);

      // Construct canonical QR payload (client-side generation simulation)
      const qrPayload = `https://tapme-ayd.pages.dev/r/${viewCard.public_token}`;
      expect(qrPayload).toContain(card.public_token);

      // 3. Verify card in database is still unconfigured
      const dbRow = await testEnv.DB.prepare(
        "SELECT configured_at FROM cards WHERE card_number = ?"
      )
        .bind(card.card_number)
        .first<{ configured_at: string | null }>();
      expect(dbRow?.configured_at).toBeNull();

      // Zero configuration audit events
      const configLogs = await testEnv.DB.prepare(
        "SELECT count(*) as count FROM audit_logs WHERE entity_id = ? AND action IN ('card.configured', 'card.updated')"
      )
        .bind(String(card.card_number))
        .first<{ count: number }>();
      expect(configLogs?.count).toBe(0);
    });

    it("allows staff to configure an unconfigured card once and records card.configured audit event", async () => {
      // 1. Create unconfigured card
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Unassigned WhatsApp Card",
            qr_type: "whatsapp",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = (await createRes.json() as any).data;
      expect(card.configured_at).toBeNull();
      expect(card.is_configured).toBe(false);

      // 2. Staff configures card for client
      const configRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Acme WhatsApp Support",
            location: "Kiosk 4",
            links: [
              {
                platform: "whatsapp",
                destination_url: "https://wa.me/1234567890?text=HelloSupport#direct",
              },
            ],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(configRes.status).toBe(200);
      const configuredCard = (await configRes.json() as any).data;
      expect(configuredCard.business_name).toBe("Acme WhatsApp Support");
      expect(configuredCard.location).toBe("Kiosk 4");
      expect(configuredCard.configured_at).not.toBeNull();
      expect(configuredCard.is_configured).toBe(true);
      expect(configuredCard.links).toHaveLength(1);
      expect(configuredCard.links[0].destination_url).toBe("https://wa.me/1234567890?text=HelloSupport#direct");

      // 3. Verify audit log event
      const auditLog = await testEnv.DB.prepare(
        "SELECT action, admin_id, details FROM audit_logs WHERE entity_id = ? AND action = 'card.configured'"
      )
        .bind(String(card.card_number))
        .first<{ action: string; admin_id: string; details: string }>();

      expect(auditLog).not.toBeNull();
      expect(auditLog?.admin_id).toBe(staffAdminId);
      const details = JSON.parse(auditLog!.details);
      expect(details.card_number).toBe(card.card_number);
      expect(details.qr_type).toBe("whatsapp");
      expect(details.is_configured).toBe(true);
      expect(details.public_token).toBeUndefined();
      // Sanitized URL without query params or fragments
      expect(details.changes.links.after[0].destination_url).toBe("https://wa.me/1234567890");
    });

    it("forbids staff from configuring or editing a card a second time (allowance consumed)", async () => {
      // 1. Create and configure card once as staff
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Initial Card",
            qr_type: "instagram",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = (await createRes.json() as any).data;

      const firstConfigRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Configured Once",
            links: [{ platform: "instagram", destination_url: "https://instagram.com/valid_handle" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(firstConfigRes.status).toBe(200);

      // 2. Staff attempts to edit or configure the card a second time
      const secondAttemptRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Unauthorized Second Edit",
            links: [{ platform: "instagram", destination_url: "https://instagram.com/another_handle" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(secondAttemptRes.status).toBe(403);
      const secondJson = (await secondAttemptRes.json()) as any;
      expect(secondJson.error).toMatch(/Staff members are not permitted to edit already-configured cards/i);

      // 3. Verify card was not modified by the second attempt
      const dbRow = await testEnv.DB.prepare(
        "SELECT business_name FROM cards WHERE card_number = ?"
      )
        .bind(card.card_number)
        .first<{ business_name: string }>();
      expect(dbRow?.business_name).toBe("Configured Once");
    });

    it("forbids staff from editing configured cards created by main admin", async () => {
      // Main admin creates an already configured card
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Admin Configured Card",
            qr_type: "google_review",
            links: [{ platform: "google_reviews", destination_url: "https://g.page/r/admin-biz" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = (await createRes.json() as any).data;
      expect(card.is_configured).toBe(true);

      // Staff attempts to edit
      const editRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Staff Overwrite",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(editRes.status).toBe(403);
      const json = (await editRes.json()) as any;
      expect(json.error).toMatch(/Staff members are not permitted to edit already-configured cards/i);
    });

    it("forbids staff from changing card lifecycle actions", async () => {
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Staff Lifecycle Test",
            qr_type: "all_in_one",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = (await createRes.json() as any).data;

      const actions = ["deactivate", "activate", "archive", "restore"];
      for (const action of actions) {
        const res = await worker.fetch(
          new Request(`http://localhost:8787/api/cards/${card.card_number}/${action}`, {
            method: "POST",
            headers: { Origin: "http://localhost:5173", Cookie: staffCookie },
          }),
          testEnv,
          { waitUntil: () => {}, passThroughOnException: () => {} } as any
        );
        expect(res.status).toBe(403);
        const json = (await res.json()) as any;
        expect(json.error).toMatch(/Main Admin permission required/i);
      }
    });

    it("forbids staff from changing qr_type during card configuration", async () => {
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Immutable Type Card",
            qr_type: "google_review",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = (await createRes.json() as any).data;

      const patchRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            qr_type: "all_in_one",
            links: [{ platform: "google_reviews", destination_url: "https://g.page/r/test" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(patchRes.status).toBe(400);
      const json = (await patchRes.json()) as any;
      expect(json.error).toMatch(/permanent and cannot be modified/i);

      // Verify card remains unconfigured
      const dbRow = await testEnv.DB.prepare(
        "SELECT qr_type, configured_at FROM cards WHERE card_number = ?"
      )
        .bind(card.card_number)
        .first<{ qr_type: string; configured_at: string | null }>();
      expect(dbRow?.qr_type).toBe("google_review");
      expect(dbRow?.configured_at).toBeNull();
    });

    it("allows main admin to edit configured and unconfigured cards repeatedly", async () => {
      // 1. Main admin creates card with links (already configured)
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Admin Editable Card",
            qr_type: "all_in_one",
            links: [{ platform: "instagram", destination_url: "https://instagram.com/orig" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = (await createRes.json() as any).data;
      expect(card.is_configured).toBe(true);

      // 2. Main admin edits card first time
      const edit1 = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Admin Edit #1",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(edit1.status).toBe(200);
      const edit1Card = (await edit1.json() as any).data;
      expect(edit1Card.business_name).toBe("Admin Edit #1");

      // 3. Main admin edits card second time
      const edit2 = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: mainAdminCookie,
          },
          body: JSON.stringify({
            business_name: "Admin Edit #2",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(edit2.status).toBe(200);
      const edit2Card = (await edit2.json() as any).data;
      expect(edit2Card.business_name).toBe("Admin Edit #2");
    });

    it("ensures invalid configuration input does not consume the staff allowance", async () => {
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Allowance Test Card",
            qr_type: "google_review",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = (await createRes.json() as any).data;
      expect(card.configured_at).toBeNull();

      // 1. Staff submits invalid destination URL: rejected
      const invalidUrlRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            links: [{ platform: "google_reviews", destination_url: "javascript:evil()" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(invalidUrlRes.status).toBe(400);

      // Verify card remains unconfigured
      let row = await testEnv.DB.prepare("SELECT configured_at FROM cards WHERE card_number = ?")
        .bind(card.card_number)
        .first<{ configured_at: string | null }>();
      expect(row?.configured_at).toBeNull();

      // 2. Staff submits platform mismatch: rejected
      const mismatchRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            links: [{ platform: "instagram", destination_url: "https://instagram.com/valid" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(mismatchRes.status).toBe(400);

      // Verify card still remains unconfigured
      row = await testEnv.DB.prepare("SELECT configured_at FROM cards WHERE card_number = ?")
        .bind(card.card_number)
        .first<{ configured_at: string | null }>();
      expect(row?.configured_at).toBeNull();

      // 3. Staff now submits VALID configuration: succeeds!
      const validConfigRes = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            links: [{ platform: "google_reviews", destination_url: "https://g.page/r/valid-reviews" }],
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      expect(validConfigRes.status).toBe(200);
      const validCard = (await validConfigRes.json() as any).data;
      expect(validCard.configured_at).not.toBeNull();
      expect(validCard.is_configured).toBe(true);
    });

    it("ensures a failed database operation preserves the unconfigured state", async () => {
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Failed DB Test Card",
            qr_type: "whatsapp",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = (await createRes.json() as any).data;

      // Mock DB.batch to simulate transient database failure
      const originalBatch = testEnv.DB.batch.bind(testEnv.DB);
      testEnv.DB.batch = (async () => {
        throw new Error("Simulated D1 outage during configuration");
      }) as any;

      try {
        const updateRes = await updateCard(
          testEnv,
          card.card_number,
          staffAdminId,
          {
            links: [{ platform: "whatsapp", destination_url: "https://wa.me/1234567890" }],
          },
          {
            links: [{ platform: "whatsapp", destination_url: "https://wa.me/1234567890" }],
          },
          "staff"
        );
        expect(updateRes.success).toBe(false);
      } finally {
        testEnv.DB.batch = originalBatch;
      }

      // Verify card remains unconfigured in the database
      const row = await testEnv.DB.prepare(
        "SELECT configured_at FROM cards WHERE card_number = ?"
      )
        .bind(card.card_number)
        .first<{ configured_at: string | null }>();
      expect(row?.configured_at).toBeNull();

      // Verify staff can successfully configure it once DB is healthy
      const retryRes = await updateCard(
        testEnv,
        card.card_number,
        staffAdminId,
        {
          links: [{ platform: "whatsapp", destination_url: "https://wa.me/1234567890" }],
        },
        {
          links: [{ platform: "whatsapp", destination_url: "https://wa.me/1234567890" }],
        },
        "staff"
      );
      expect(retryRes.success).toBe(true);
    });

    it("handles concurrent configuration attempts such that exactly one succeeds", async () => {
      // Create unconfigured card
      const createRes = await worker.fetch(
        new Request("http://localhost:8787/api/cards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
            Cookie: staffCookie,
          },
          body: JSON.stringify({
            business_name: "Race Condition Card",
            qr_type: "instagram",
          }),
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );
      const card = (await createRes.json() as any).data;

      // Launch two concurrent configuration requests targeting the same card
      const reqA = new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
          Cookie: staffCookie,
        },
        body: JSON.stringify({
          business_name: "Configuration from Worker A",
          links: [{ platform: "instagram", destination_url: "https://instagram.com/worker_a" }],
        }),
      });

      const reqB = new Request(`http://localhost:8787/api/cards/${card.card_number}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
          Cookie: staffCookie,
        },
        body: JSON.stringify({
          business_name: "Configuration from Worker B",
          links: [{ platform: "instagram", destination_url: "https://instagram.com/worker_b" }],
        }),
      });

      const [resA, resB] = await Promise.all([
        worker.fetch(reqA, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any),
        worker.fetch(reqB, testEnv, { waitUntil: () => {}, passThroughOnException: () => {} } as any),
      ]);

      const statuses = [resA.status, resB.status];

      // Exactly one request must succeed (200) and the other must be forbidden (403)
      expect(statuses).toContain(200);
      expect(statuses).toContain(403);

      // Verify database record has exactly one configuration committed
      const dbRow = await testEnv.DB.prepare(
        "SELECT business_name, configured_at FROM cards WHERE card_number = ?"
      )
        .bind(card.card_number)
        .first<{ business_name: string; configured_at: string }>();

      expect(dbRow?.configured_at).not.toBeNull();
      expect(
        dbRow?.business_name === "Configuration from Worker A" ||
        dbRow?.business_name === "Configuration from Worker B"
      ).toBe(true);

      // Verify audit logs contain exactly ONE card.configured event
      const auditCount = await testEnv.DB.prepare(
        "SELECT count(*) as count FROM audit_logs WHERE entity_id = ? AND action = 'card.configured'"
      )
        .bind(String(card.card_number))
        .first<{ count: number }>();

      expect(auditCount?.count).toBe(1);
    });

    it("correctly classifies intentional staff concurrency abort on status as 403", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        { business_name: "Staff Abort Test", qr_type: "instagram" },
        { business_name: "Staff Abort Test", qr_type: "instagram" }
      );
      if (!created.success) throw new Error("Failed to create card");

      // Mock DB.batch to throw the exact D1 status CHECK constraint failure
      const originalBatch = testEnv.DB.batch.bind(testEnv.DB);
      testEnv.DB.batch = (async () => {
        throw new Error("D1_ERROR: CHECK constraint failed: status IN ('active', 'inactive', 'archived')");
      }) as any;

      try {
        const res = await updateCard(
          testEnv,
          created.card.card_number,
          staffAdminId,
          {
            business_name: "Staff Update Attempt",
            links: [{ platform: "instagram", destination_url: "https://instagram.com/staff" }],
          },
          {
            business_name: "Staff Update Attempt",
            links: [{ platform: "instagram", destination_url: "https://instagram.com/staff" }],
          },
          "staff"
        );

        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.status).toBe(403);
          expect(res.error).toBe("Staff members are not permitted to edit already-configured cards.");
        }
      } finally {
        testEnv.DB.batch = originalBatch;
      }
    });

    it("does not report unrelated database CHECK constraint failures as staff 403", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        { business_name: "Staff Unrelated Check Test", qr_type: "whatsapp" },
        { business_name: "Staff Unrelated Check Test", qr_type: "whatsapp" }
      );
      if (!created.success) throw new Error("Failed to create card");

      // Mock DB.batch to throw an unrelated CHECK constraint error (e.g., platform)
      const originalBatch = testEnv.DB.batch.bind(testEnv.DB);
      testEnv.DB.batch = (async () => {
        throw new Error("D1_ERROR: CHECK constraint failed: card_links.platform IN ('google_reviews', 'instagram', 'whatsapp', 'other')");
      }) as any;

      try {
        const res = await updateCard(
          testEnv,
          created.card.card_number,
          staffAdminId,
          {
            business_name: "Staff Unrelated Check",
            links: [{ platform: "whatsapp", destination_url: "https://wa.me/1234567890" }],
          },
          {
            business_name: "Staff Unrelated Check",
            links: [{ platform: "whatsapp", destination_url: "https://wa.me/1234567890" }],
          },
          "staff"
        );

        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.status).toBe(500);
          expect(res.error).toBe("Database error while updating card.");
          expect(res.error).not.toContain("Staff members are not permitted");
        }
      } finally {
        testEnv.DB.batch = originalBatch;
      }
    });

    it("preserves correct error classification (500) for main admin updates on CHECK constraint failures", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        { business_name: "Admin Check Error Test", qr_type: "all_in_one" },
        { business_name: "Admin Check Error Test", qr_type: "all_in_one" }
      );
      if (!created.success) throw new Error("Failed to create card");

      // Mock DB.batch to throw a CHECK constraint failure during a main-admin update
      const originalBatch = testEnv.DB.batch.bind(testEnv.DB);
      testEnv.DB.batch = (async () => {
        throw new Error("D1_ERROR: CHECK constraint failed: status IN ('active', 'inactive', 'archived')");
      }) as any;

      try {
        const res = await updateCard(
          testEnv,
          created.card.card_number,
          mainAdminId,
          {
            business_name: "Admin Update Triggering Error",
            links: [{ platform: "other", destination_url: "https://admin-error.com" }],
          },
          {
            business_name: "Admin Update Triggering Error",
            links: [{ platform: "other", destination_url: "https://admin-error.com" }],
          },
          "main_admin"
        );

        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.status).toBe(500);
          expect(res.error).toBe("Database error while updating card.");
          expect(res.error).not.toContain("Staff members are not permitted");
        }
      } finally {
        testEnv.DB.batch = originalBatch;
      }
    });
  });

  describe("Authenticated Card Lookup by Public Token (Phase 4 Scanner API)", () => {
    it("allows main admin to look up a card by its permanent public_token", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Admin Scanned Cafe",
          qr_type: "google_review",
          links: [{ platform: "google_reviews", destination_url: "https://g.page/admin-scanned", is_enabled: true }],
        },
        { business_name: "Admin Scanned Cafe", qr_type: "google_review" }
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const res = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/lookup-by-token/${created.card.public_token}`, {
          method: "GET",
          headers: { Cookie: mainAdminCookie },
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.card_number).toBe(created.card.card_number);
      expect(json.data.formatted_card_number).toBe(created.card.formatted_card_number);
      expect(json.data.public_token).toBe(created.card.public_token);
      expect(json.data.business_name).toBe("Admin Scanned Cafe");
      expect(json.data.qr_type).toBe("google_review");
      expect(json.data.is_configured).toBe(true);
      expect(json.data.links).toHaveLength(1);
    });

    it("allows staff to look up a card by its permanent public_token", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Staff Scanned Preprinted",
          qr_type: "all_in_one",
        },
        { business_name: "Staff Scanned Preprinted", qr_type: "all_in_one" }
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const res = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/lookup-by-token/${created.card.public_token}`, {
          method: "GET",
          headers: { Cookie: staffCookie },
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.card_number).toBe(created.card.card_number);
      expect(json.data.business_name).toBe("Staff Scanned Preprinted");
      expect(json.data.qr_type).toBe("all_in_one");
      expect(json.data.is_configured).toBe(false);
      expect(json.data.configured_at).toBeNull();
      expect(json.data.links).toHaveLength(0);
    });

    it("rejects unauthenticated lookup requests with 401 Unauthorized", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Public Probe Target",
          qr_type: "whatsapp",
        },
        { business_name: "Public Probe Target", qr_type: "whatsapp" }
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const res = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/lookup-by-token/${created.card.public_token}`, {
          method: "GET",
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error).toBe("Authentication required.");
    });

    it("returns neutral 404 for an unknown public_token", async () => {
      const nonExistentToken = "NonExistentToken_123456789012";

      const res = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/lookup-by-token/${nonExistentToken}`, {
          method: "GET",
          headers: { Cookie: staffCookie },
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(res.status).toBe(404);
      const json = (await res.json()) as any;
      expect(json.success).toBe(false);
      expect(json.error).toBe("Card not found.");
    });

    it("rejects malformed public tokens with 400 Bad Request before querying D1", async () => {
      const invalidTokens = [
        "short",
        "has spaces in token",
        "has$illegal*chars!",
        "nested/path/attempt",
      ];

      for (const badToken of invalidTokens) {
        const res = await worker.fetch(
          new Request(`http://localhost:8787/api/cards/lookup-by-token/${encodeURIComponent(badToken)}`, {
            method: "GET",
            headers: { Cookie: mainAdminCookie },
          }),
          testEnv,
          { waitUntil: () => {}, passThroughOnException: () => {} } as any
        );

        expect(res.status).toBe(400);
        const json = (await res.json()) as any;
        expect(json.success).toBe(false);
        expect(json.error).toBe("Invalid public token format.");
      }
    });

    it("does not expose sensitive account, session, or internal secret data", async () => {
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Safe Leakage Check",
          qr_type: "instagram",
          links: [{ platform: "instagram", destination_url: "https://instagram.com/safe", is_enabled: true }],
        },
        { business_name: "Safe Leakage Check", qr_type: "instagram" }
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      const res = await worker.fetch(
        new Request(`http://localhost:8787/api/cards/lookup-by-token/${created.card.public_token}`, {
          method: "GET",
          headers: { Cookie: staffCookie },
        }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      const data = json.data;

      // Verify no sensitive fields
      expect(data.password_hash).toBeUndefined();
      expect(data.password_pepper).toBeUndefined();
      expect(data.session_token).toBeUndefined();
      expect(data.admin_secret).toBeUndefined();
      expect(data.created_by).toBeUndefined();
      expect(data.updated_by).toBeUndefined();
    });

    it("preserves unchanged public redirect behavior while lookup API is active", async () => {
      const dest = "https://g.page/r/tapme-public-redirect";
      const created = await createCard(
        testEnv,
        mainAdminId,
        {
          business_name: "Public Invariant Check",
          qr_type: "google_review",
          links: [{ platform: "google_reviews", destination_url: dest, is_enabled: true }],
        },
        { business_name: "Public Invariant Check", qr_type: "google_review" }
      );
      expect(created.success).toBe(true);
      if (!created.success) return;

      // Public redirect continues returning HTTP 302 to destination
      const pubRes = await worker.fetch(
        new Request(`http://localhost:8787/r/${created.card.public_token}`, { redirect: "manual" }),
        testEnv,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any
      );

      expect(pubRes.status).toBe(302);
      expect(pubRes.headers.get("Location")).toBe(dest);
    });
  });
});
