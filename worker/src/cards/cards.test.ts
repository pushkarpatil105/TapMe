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
      { business_name: "Acme Coffee", location: "Downtown" }
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.card.card_number).toBeGreaterThanOrEqual(1);
      expect(res.card.formatted_card_number).toMatch(/^\d{3,}$/);
      expect(res.card.business_name).toBe("Acme Coffee");
      expect(res.card.location).toBe("Downtown");
      expect(res.card.status).toBe("active");
      expect(res.card.links).toHaveLength(2);
      expect(res.card.links![0].platform).toBe("google_reviews");
      expect(res.card.links![1].platform).toBe("whatsapp");
    }
  });

  it("rejects card creation when card_number or public_token is provided", async () => {
    const res = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Test" },
      { business_name: "Test", card_number: 999 }
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
      { business_name: "Flower Shop", location: "Westside" },
      { business_name: "Flower Shop" }
    );

    expect(created.success).toBe(true);
    if (created.success) {
      const byNumber = await getCardByIdOrToken(testEnv, created.card.card_number);
      expect(byNumber).not.toBeNull();
      expect(byNumber!.business_name).toBe("Flower Shop");

      const byToken = await getCardByIdOrToken(testEnv, created.card.public_token);
      expect(byToken).not.toBeNull();
      expect(byToken!.card_number).toBe(created.card.card_number);
    }
  });

  it("updates card fields and preserves existing links when links is omitted", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      {
        business_name: "Bakery",
        links: [
          { platform: "instagram", destination_url: "https://instagram.com/bakery" },
        ],
      },
      { business_name: "Bakery" }
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
        links: [
          { platform: "instagram", destination_url: "https://instagram.com/books" },
        ],
      },
      { business_name: "Bookstore" }
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
      { business_name: "Trigger Test" },
      { business_name: "Trigger Test" }
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
  });

  it("GET /api/cards lists cards newest first", async () => {
    await createCard(
      testEnv,
      mainAdminId,
      { business_name: "First Shop" },
      { business_name: "First Shop" }
    );
    await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Second Shop" },
      { business_name: "Second Shop" }
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
        links: [
          { platform: "whatsapp", destination_url: "https://wa.me/5551234" },
        ],
      },
      { business_name: "Detail Shop" }
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
      { business_name: "Before Patch" },
      { business_name: "Before Patch" }
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

  it("PATCH /api/cards/:id forbids Staff with 403", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Staff Cannot Edit" },
      { business_name: "Staff Cannot Edit" }
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
    expect(json.error).toContain("Main Admin permission required");
  });

  it("PATCH /api/cards/:id rejects attempts to edit card_number or public_token", async () => {
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Immutable Test" },
      { business_name: "Immutable Test" }
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
    expect(json.error).toContain("card_number and public_token are permanent");
  });
});

describe("Card Lifecycle Management & Filtering", () => {
  it("executes all valid lifecycle transitions correctly", async () => {
    // 1. Newly created card starts as active
    const created = await createCard(
      testEnv,
      mainAdminId,
      { business_name: "Lifecycle Cafe" },
      { business_name: "Lifecycle Cafe" }
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
      { business_name: "Transition Check" },
      { business_name: "Transition Check" }
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
      { business_name: "Original Name" },
      { business_name: "Original Name" }
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
      { business_name: "Staff Permissions Test" },
      { business_name: "Staff Permissions Test" }
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
    const card1 = await createCard(testEnv, mainAdminId, { business_name: "Active Card" }, { business_name: "Active Card" });
    const card2 = await createCard(testEnv, mainAdminId, { business_name: "Inactive Card" }, { business_name: "Inactive Card" });
    const card3 = await createCard(testEnv, mainAdminId, { business_name: "Archived Card" }, { business_name: "Archived Card" });

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
        links: [
          { platform: "google_reviews", destination_url: "https://g.page/r/test", is_enabled: true },
          { platform: "instagram", destination_url: "https://instagram.com/preserved", is_enabled: true },
        ],
      },
      { business_name: "Preserved Enterprise" }
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
      { business_name: "Audit Test Corp" },
      { business_name: "Audit Test Corp" }
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

    expect(logs.results).toHaveLength(4);

    const [deactLog, actLog, archLog, restLog] = logs.results;

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
});
