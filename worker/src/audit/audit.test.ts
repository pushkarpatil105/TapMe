import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import type { AppEnv } from "../types";
import { listAuditLogs } from "./audit";
import { createSession, createSessionCookie } from "../auth/session";
import worker from "../index";

const testEnv = env as AppEnv;

let mainAdminId: string;
let mainAdminUsername: string;
let staffAdminId: string;
let staffAdminUsername: string;
let mainAdminCookie: string;
let staffCookie: string;

beforeEach(async () => {
  mainAdminId = crypto.randomUUID();
  mainAdminUsername = `main_${mainAdminId.slice(0, 8)}`;
  staffAdminId = crypto.randomUUID();
  staffAdminUsername = `staff_${staffAdminId.slice(0, 8)}`;

  // Seed primary main_admin
  await testEnv.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role, status)
     VALUES (?, ?, 'hash_main', 'main_admin', 'active')`
  )
    .bind(mainAdminId, mainAdminUsername)
    .run();

  // Seed staff admin
  await testEnv.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role, status)
     VALUES (?, ?, 'hash_staff', 'staff', 'active')`
  )
    .bind(staffAdminId, staffAdminUsername)
    .run();

  // Create sessions and auth cookies
  const mainSession = await createSession(testEnv, mainAdminId);
  mainAdminCookie = createSessionCookie(testEnv, mainSession.token);

  const staffSession = await createSession(testEnv, staffAdminId);
  staffCookie = createSessionCookie(testEnv, staffSession.token);
});

afterEach(async () => {
  await testEnv.DB.prepare("DELETE FROM audit_logs").run();
  await testEnv.DB.prepare("DELETE FROM sessions").run();
  await testEnv.DB.prepare("DELETE FROM admins").run();
});

// Helper to insert test audit entries directly
async function insertAuditEntry(entry: {
  id?: string;
  admin_id: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  details?: Record<string, unknown> | string;
  created_at?: string;
}) {
  const id = entry.id || crypto.randomUUID();
  const detailsStr =
    typeof entry.details === "string"
      ? entry.details
      : JSON.stringify(entry.details || {});

  if (entry.created_at) {
    await testEnv.DB.prepare(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        entry.admin_id,
        entry.action,
        entry.entity_type,
        entry.entity_id ?? null,
        detailsStr,
        entry.created_at,
      )
      .run();
  } else {
    await testEnv.DB.prepare(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        entry.admin_id,
        entry.action,
        entry.entity_type,
        entry.entity_id ?? null,
        detailsStr,
      )
      .run();
  }

  return id;
}

describe("Audit Logs Service — listAuditLogs()", () => {
  it("returns default pagination and logs when no query params are provided", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "card.created",
      entity_type: "card",
      entity_id: "1",
      details: { business_name: "Test Cafe" },
    });

    await insertAuditEntry({
      admin_id: staffAdminId,
      action: "card.created",
      entity_type: "card",
      entity_id: "2",
      details: { business_name: "Staff Cafe" },
    });

    const res = await listAuditLogs(testEnv);
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 2,
      total_pages: 1,
    });
    expect(res.data.logs).toHaveLength(2);
  });

  it("applies pagination correctly with page and limit", async () => {
    for (let i = 1; i <= 5; i++) {
      await insertAuditEntry({
        admin_id: mainAdminId,
        action: `action_${i}`,
        entity_type: "test",
        created_at: `2026-01-01 10:00:0${i}`,
      });
    }

    // Page 1, limit 2
    const res1 = await listAuditLogs(testEnv, { page: 1, limit: 2 });
    expect(res1.success).toBe(true);
    if (!res1.success) return;
    expect(res1.data.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 5,
      total_pages: 3,
    });
    expect(res1.data.logs).toHaveLength(2);
    expect(res1.data.logs[0].action).toBe("action_5");
    expect(res1.data.logs[1].action).toBe("action_4");

    // Page 2, limit 2
    const res2 = await listAuditLogs(testEnv, { page: 2, limit: 2 });
    expect(res2.success).toBe(true);
    if (!res2.success) return;
    expect(res2.data.logs).toHaveLength(2);
    expect(res2.data.logs[0].action).toBe("action_3");
    expect(res2.data.logs[1].action).toBe("action_2");

    // Page 3, limit 2 (last remaining item)
    const res3 = await listAuditLogs(testEnv, { page: 3, limit: 2 });
    expect(res3.success).toBe(true);
    if (!res3.success) return;
    expect(res3.data.logs).toHaveLength(1);
    expect(res3.data.logs[0].action).toBe("action_1");
  });

  it("enforces deterministic ordering by created_at DESC, rowid DESC", async () => {
    // Two entries with identical created_at timestamp
    const timestamp = "2026-02-15 12:00:00";
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "first_inserted",
      entity_type: "ordering_test",
      created_at: timestamp,
    });

    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "second_inserted",
      entity_type: "ordering_test",
      created_at: timestamp,
    });

    const res = await listAuditLogs(testEnv);
    expect(res.success).toBe(true);
    if (!res.success) return;

    // The second inserted has a higher rowid, so it must appear first
    expect(res.data.logs[0].action).toBe("second_inserted");
    expect(res.data.logs[1].action).toBe("first_inserted");
  });

  it("filters logs by action", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "card.created",
      entity_type: "card",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "staff.created",
      entity_type: "staff",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "card.status_changed",
      entity_type: "card",
    });

    const res = await listAuditLogs(testEnv, { action: "card.created" });
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.pagination.total).toBe(1);
    expect(res.data.logs).toHaveLength(1);
    expect(res.data.logs[0].action).toBe("card.created");
  });

  it("filters logs by entity_type", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "card.created",
      entity_type: "card",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "card.updated",
      entity_type: "card",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "staff.created",
      entity_type: "staff",
    });

    const res = await listAuditLogs(testEnv, { entity_type: "card" });
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.pagination.total).toBe(2);
    expect(res.data.logs.every((l) => l.entity_type === "card")).toBe(true);
  });

  it("filters logs by admin_id", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "action.by.main",
      entity_type: "card",
    });
    await insertAuditEntry({
      admin_id: staffAdminId,
      action: "action.by.staff",
      entity_type: "card",
    });

    const res = await listAuditLogs(testEnv, { admin_id: staffAdminId });
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.pagination.total).toBe(1);
    expect(res.data.logs[0].admin_id).toBe(staffAdminId);
    expect(res.data.logs[0].admin_username).toBe(staffAdminUsername);
  });

  it("filters logs by inclusive date range with YYYY-MM-DD", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "early",
      entity_type: "test",
      created_at: "2026-03-09 23:59:59",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "in_range_day_start",
      entity_type: "test",
      created_at: "2026-03-10 00:00:00",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "in_range_day_end",
      entity_type: "test",
      created_at: "2026-03-10 23:59:59",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "late",
      entity_type: "test",
      created_at: "2026-03-11 00:00:00",
    });

    // Query for 2026-03-10 single day
    const res = await listAuditLogs(testEnv, {
      start_date: "2026-03-10",
      end_date: "2026-03-10",
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.pagination.total).toBe(2);
    const actions = res.data.logs.map((l) => l.action);
    expect(actions).toContain("in_range_day_start");
    expect(actions).toContain("in_range_day_end");
    expect(actions).not.toContain("early");
    expect(actions).not.toContain("late");
  });

  it("filters logs by ISO 8601 timestamp with start_date and end_date", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "iso_before",
      entity_type: "test",
      created_at: "2026-04-01 11:59:59",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "iso_target",
      entity_type: "test",
      created_at: "2026-04-01 12:30:00",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "iso_exact_end",
      entity_type: "test",
      created_at: "2026-04-01 13:00:00",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "iso_after",
      entity_type: "test",
      created_at: "2026-04-01 13:00:01",
    });

    const res = await listAuditLogs(testEnv, {
      start_date: "2026-04-01T12:00:00Z",
      end_date: "2026-04-01T13:00:00Z",
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.pagination.total).toBe(2);
    const actions = res.data.logs.map((l) => l.action);
    expect(actions).toContain("iso_target");
    expect(actions).toContain("iso_exact_end");
    expect(actions).not.toContain("iso_before");
    expect(actions).not.toContain("iso_after");
  });

  it("includes records with fractional-second timestamps on final day for date-only end_date", async () => {
    // Records on final day (2026-11-03) with fractional seconds
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "fractional_half_sec",
      entity_type: "test",
      created_at: "2026-11-03 23:59:59.500",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "fractional_near_midnight",
      entity_type: "test",
      created_at: "2026-11-03 23:59:59.999",
    });
    // Record at exact midnight of next day (2026-11-04 00:00:00) - must be excluded
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "next_day_exact_midnight",
      entity_type: "test",
      created_at: "2026-11-04 00:00:00.000",
    });
    // Record after midnight of next day - must be excluded
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "next_day_morning",
      entity_type: "test",
      created_at: "2026-11-04 00:00:01",
    });

    const res = await listAuditLogs(testEnv, {
      start_date: "2026-11-03",
      end_date: "2026-11-03",
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.pagination.total).toBe(2);
    const actions = res.data.logs.map((l) => l.action);
    expect(actions).toContain("fractional_half_sec");
    expect(actions).toContain("fractional_near_midnight");
    expect(actions).not.toContain("next_day_exact_midnight");
    expect(actions).not.toContain("next_day_morning");
  });

  it("preserves ISO timestamp filtering semantics with fractional seconds", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "iso_frac_450",
      entity_type: "test",
      created_at: "2026-04-01 13:00:00.450",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "iso_frac_500",
      entity_type: "test",
      created_at: "2026-04-01 13:00:00.500",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "iso_frac_550",
      entity_type: "test",
      created_at: "2026-04-01 13:00:00.550",
    });

    const res = await listAuditLogs(testEnv, {
      start_date: "2026-04-01T13:00:00.000Z",
      end_date: "2026-04-01T13:00:00.500Z",
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.pagination.total).toBe(2);
    const actions = res.data.logs.map((l) => l.action);
    expect(actions).toContain("iso_frac_450");
    expect(actions).toContain("iso_frac_500");
    expect(actions).not.toContain("iso_frac_550");
  });

  it("rejects when start_date is later than end_date", async () => {
    // Date-only start later than end
    const res = await listAuditLogs(testEnv, {
      start_date: "2026-05-10",
      end_date: "2026-05-01",
    });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("start_date must be earlier than or equal to end_date");
    }

    // Consecutive day inverted (Nov 4 start vs Nov 3 end)
    const resConsecutive = await listAuditLogs(testEnv, {
      start_date: "2026-11-04",
      end_date: "2026-11-03",
    });

    expect(resConsecutive.success).toBe(false);
    if (!resConsecutive.success) {
      expect(resConsecutive.status).toBe(400);
      expect(resConsecutive.error).toContain("start_date must be earlier than or equal to end_date");
    }

    // ISO timestamp start later than date-only end
    const resMixed = await listAuditLogs(testEnv, {
      start_date: "2026-11-04T00:00:00Z",
      end_date: "2026-11-03",
    });

    expect(resMixed.success).toBe(false);
    if (!resMixed.success) {
      expect(resMixed.status).toBe(400);
      expect(resMixed.error).toContain("start_date must be earlier than or equal to end_date");
    }
  });

  it("rejects invalid date formats", async () => {
    const resStart = await listAuditLogs(testEnv, {
      start_date: "not-a-real-date",
    });
    expect(resStart.success).toBe(false);
    if (!resStart.success) {
      expect(resStart.status).toBe(400);
      expect(resStart.error).toContain("Invalid start_date format");
    }

    const resEnd = await listAuditLogs(testEnv, {
      end_date: "2026-02-31", // invalid date in February
    });
    expect(resEnd.success).toBe(false);
    if (!resEnd.success) {
      expect(resEnd.status).toBe(400);
      expect(resEnd.error).toContain("Invalid end_date format");
    }
  });

  it("rejects invalid pagination values", async () => {
    // page < 1
    const resPageZero = await listAuditLogs(testEnv, { page: 0 });
    expect(resPageZero.success).toBe(false);
    if (!resPageZero.success) expect(resPageZero.status).toBe(400);

    const resPageNegative = await listAuditLogs(testEnv, { page: -1 });
    expect(resPageNegative.success).toBe(false);
    if (!resPageNegative.success) expect(resPageNegative.status).toBe(400);

    const resPageAlpha = await listAuditLogs(testEnv, { page: "abc" });
    expect(resPageAlpha.success).toBe(false);
    if (!resPageAlpha.success) expect(resPageAlpha.status).toBe(400);

    // limit < 1 or > 100
    const resLimitZero = await listAuditLogs(testEnv, { limit: 0 });
    expect(resLimitZero.success).toBe(false);
    if (!resLimitZero.success) expect(resLimitZero.status).toBe(400);

    const resLimitOver = await listAuditLogs(testEnv, { limit: 101 });
    expect(resLimitOver.success).toBe(false);
    if (!resLimitOver.success) expect(resLimitOver.status).toBe(400);

    const resLimitAlpha = await listAuditLogs(testEnv, { limit: "foo" });
    expect(resLimitAlpha.success).toBe(false);
    if (!resLimitAlpha.success) expect(resLimitAlpha.status).toBe(400);
  });

  it("preserves actor username via LEFT JOIN even when admin is disabled or soft-removed", async () => {
    // 1. Create audit log for staff
    await insertAuditEntry({
      admin_id: staffAdminId,
      action: "card.created",
      entity_type: "card",
    });

    // 2. Soft-remove staff admin (deleted_at set, status disabled)
    await testEnv.DB.prepare(
      `UPDATE admins
       SET status = 'disabled', deleted_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(staffAdminId)
      .run();

    const res = await listAuditLogs(testEnv);
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.logs).toHaveLength(1);
    expect(res.data.logs[0].admin_id).toBe(staffAdminId);
    // Actor username is preserved even though admin is disabled and deleted_at is set
    expect(res.data.logs[0].admin_username).toBe(staffAdminUsername);
  });

  it("handles audit rows where admin record is unavailable, returning admin_username: null without dropping audit records", async () => {
    // If an actor record is unavailable in the database, LEFT JOIN yields NULL for admin_username
    // Verify that listAuditLogs gracefully sets admin_username to null without dropping the record
    const mockDb = {
      prepare: (sql: string) => {
        if (sql.includes("count(*)")) {
          return {
            bind: () => ({
              first: async () => ({ total: 1 }),
            }),
          };
        }
        return {
          bind: () => ({
            all: async () => ({
              results: [
                {
                  id: "log-orphan",
                  admin_id: "missing-admin-id",
                  admin_username: null,
                  action: "orphan.action",
                  entity_type: "system",
                  entity_id: null,
                  details: "{}",
                  created_at: "2026-03-01 12:00:00",
                },
              ],
            }),
          }),
        };
      },
    };

    const res = await listAuditLogs({ ...testEnv, DB: mockDb as any });
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.logs).toHaveLength(1);
    expect(res.data.logs[0].id).toBe("log-orphan");
    expect(res.data.logs[0].admin_id).toBe("missing-admin-id");
    expect(res.data.logs[0].admin_username).toBeNull();
  });

  it("parses valid JSON details into structured objects, and preserves non-JSON details as string", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "json.test",
      entity_type: "card",
      details: { foo: "bar", count: 42 },
    });

    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "raw.test",
      entity_type: "card",
      details: "plain text log detail",
    });

    const res = await listAuditLogs(testEnv);
    expect(res.success).toBe(true);
    if (!res.success) return;

    const jsonEntry = res.data.logs.find((l) => l.action === "json.test");
    expect(jsonEntry?.details).toEqual({ foo: "bar", count: 42 });

    const rawEntry = res.data.logs.find((l) => l.action === "raw.test");
    expect(rawEntry?.details).toBe("plain text log detail");
  });

  it("safely handles SQL injection attempts in query parameters as literals", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "card.created",
      entity_type: "card",
    });

    // Attempt SQL injection via action
    const sqlInjAction = "' OR '1'='1";
    const resAction = await listAuditLogs(testEnv, { action: sqlInjAction });
    expect(resAction.success).toBe(true);
    if (resAction.success) {
      expect(resAction.data.logs).toHaveLength(0);
      expect(resAction.data.pagination.total).toBe(0);
    }

    // Attempt SQL injection via entity_type
    const sqlInjEntity = "card' UNION SELECT 1, 2, 3, 4, 5, 6, 7, 8 --";
    const resEntity = await listAuditLogs(testEnv, { entity_type: sqlInjEntity });
    expect(resEntity.success).toBe(true);
    if (resEntity.success) {
      expect(resEntity.data.logs).toHaveLength(0);
      expect(resEntity.data.pagination.total).toBe(0);
    }
  });
});

describe("Audit Logs Endpoint — GET /api/audit-logs RBAC & Integration", () => {
  it("allows Main Admin to retrieve audit logs with 200 OK", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "card.created",
      entity_type: "card",
      details: { business_name: "Http Cafe" },
    });

    const req = new Request("http://localhost:8787/api/audit-logs", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: mainAdminCookie,
      },
    });

    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.logs).toHaveLength(1);
    expect(body.data.logs[0].action).toBe("card.created");
    expect(body.data.logs[0].admin_username).toBe(mainAdminUsername);
    expect(body.data.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      total_pages: 1,
    });
  });

  it("forbids Staff member from retrieving audit logs with 403 Forbidden", async () => {
    const req = new Request("http://localhost:8787/api/audit-logs", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: staffCookie,
      },
    });

    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toContain("Main Admin permission required");
  });

  it("returns 401 Unauthorized when request has no authentication session", async () => {
    const req = new Request("http://localhost:8787/api/audit-logs", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toContain("Authentication required");
  });

  it("supports URL search params for filtering and pagination via GET /api/audit-logs", async () => {
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "card.created",
      entity_type: "card",
    });
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "staff.created",
      entity_type: "staff",
    });

    const req = new Request(
      "http://localhost:8787/api/audit-logs?action=staff.created&page=1&limit=5",
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Cookie: mainAdminCookie,
        },
      }
    );

    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.pagination.total).toBe(1);
    expect(body.data.logs).toHaveLength(1);
    expect(body.data.logs[0].action).toBe("staff.created");
  });

  it("filters audit logs by search query (card number, business name, or actor username)", async () => {
    // 1. Insert entry for Card 6 with business_name "Green Leaf Cafe"
    await insertAuditEntry({
      admin_id: mainAdminId,
      action: "card.created",
      entity_type: "card",
      entity_id: "6",
      details: { card_number: 6, business_name: "Green Leaf Cafe" },
      created_at: "2026-11-06 10:00:00",
    });

    // 2. Insert entry for Card 12 with business_name "Sunset Bakery"
    await insertAuditEntry({
      admin_id: staffAdminId,
      action: "card.configured",
      entity_type: "card",
      entity_id: "12",
      details: { card_number: 12, business_name: "Sunset Bakery" },
      created_at: "2026-11-06 11:00:00",
    });

    // Search by numeric card number "6"
    const resCardNum = await listAuditLogs(testEnv, { search: "6" });
    expect(resCardNum.success).toBe(true);
    if (resCardNum.success) {
      expect(resCardNum.data.logs).toHaveLength(1);
      expect(resCardNum.data.logs[0].entity_id).toBe("6");
    }

    // Search by zero-padded card number "006"
    const resPadded = await listAuditLogs(testEnv, { search: "006" });
    expect(resPadded.success).toBe(true);
    if (resPadded.success) {
      expect(resPadded.data.logs).toHaveLength(1);
      expect(resPadded.data.logs[0].entity_id).toBe("6");
    }

    // Search by business name substring "Sunset"
    const resBusiness = await listAuditLogs(testEnv, { search: "Sunset" });
    expect(resBusiness.success).toBe(true);
    if (resBusiness.success) {
      expect(resBusiness.data.logs).toHaveLength(1);
      expect(resBusiness.data.logs[0].entity_id).toBe("12");
    }

    // Search by staff actor username substring
    const resActor = await listAuditLogs(testEnv, { search: staffAdminUsername });
    expect(resActor.success).toBe(true);
    if (resActor.success) {
      expect(resActor.data.logs.some((l) => l.admin_username === staffAdminUsername)).toBe(true);
    }
  });

  it("returns 400 Bad Request when search parameter exceeds 100 characters", async () => {
    const res = await listAuditLogs(testEnv, { search: "a".repeat(101) });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("search must be a valid string up to 100 characters");
    }
  });

  it("returns 400 Bad Request when invalid query parameters are supplied", async () => {
    const req = new Request(
      "http://localhost:8787/api/audit-logs?limit=500",
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Cookie: mainAdminCookie,
        },
      }
    );

    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("limit must be a positive integer between 1 and 100");
  });
});

describe("Audit Logs Immutability — Zero Mutation Endpoints", () => {
  it("rejects POST /api/audit-logs with 404 Route not found", async () => {
    const req = new Request("http://localhost:8787/api/audit-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "http://localhost:5173",
        Cookie: mainAdminCookie,
      },
      body: JSON.stringify({ action: "fake.action" }),
    });

    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(404);
  });

  it("rejects PATCH /api/audit-logs with 404 Route not found", async () => {
    const req = new Request("http://localhost:8787/api/audit-logs/123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "http://localhost:5173",
        Cookie: mainAdminCookie,
      },
      body: JSON.stringify({ details: "tampered" }),
    });

    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(404);
  });

  it("rejects DELETE /api/audit-logs with 404 Route not found", async () => {
    const req = new Request("http://localhost:8787/api/audit-logs", {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Origin: "http://localhost:5173",
        Cookie: mainAdminCookie,
      },
    });

    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(404);
  });
});

