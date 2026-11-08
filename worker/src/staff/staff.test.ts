import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import type { AppEnv } from "../types";
import { listStaff, createStaff, changeStaffStatus } from "./staff";
import { createSession, createSessionCookie, getSession } from "../auth/session";
import { verifyPassword } from "../auth/password";
import { loginAdmin } from "../auth/auth";
import worker from "../index";

const testEnv = env as AppEnv;

let mainAdminId: string;
let staffAdminId: string;
let mainAdminCookie: string;
let staffCookie: string;

beforeEach(async () => {
  mainAdminId = crypto.randomUUID();
  staffAdminId = crypto.randomUUID();

  // Create primary main_admin
  await testEnv.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role, status)
     VALUES (?, ?, ?, 'main_admin', 'active')`
  )
    .bind(mainAdminId, `main_${mainAdminId.slice(0, 8)}`, "hash_main")
    .run();

  // Create existing staff member
  await testEnv.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role, status)
     VALUES (?, ?, ?, 'staff', 'active')`
  )
    .bind(staffAdminId, `staff_${staffAdminId.slice(0, 8)}`, "hash_staff")
    .run();

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

describe("Staff Management Service — Unit Operations", () => {
  it("creates a staff account with valid hashed password and atomic audit event", async () => {
    const rawPassword = "StrongPassword123!";
    const res = await createStaff(testEnv, mainAdminId, {
      username: "alice_staff",
      password: rawPassword,
    });

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.id).toBeTruthy();
    expect(res.data.username).toBe("alice_staff");
    expect(res.data.role).toBe("staff");
    expect(res.data.status).toBe("active");
    expect(res.data.created_by).toBe(mainAdminId);
    expect(res.data.deleted_at).toBeNull();
    // Verify password hash is NEVER returned
    expect((res.data as unknown as Record<string, unknown>).password_hash).toBeUndefined();

    // Verify database record has valid hash that verifies against PASSWORD_PEPPER
    const dbRecord = await testEnv.DB.prepare(
      "SELECT password_hash FROM admins WHERE id = ?"
    )
      .bind(res.data.id)
      .first<{ password_hash: string }>();

    expect(dbRecord).not.toBeNull();
    const isValid = await verifyPassword(
      rawPassword,
      dbRecord!.password_hash,
      testEnv.PASSWORD_PEPPER,
    );
    expect(isValid).toBe(true);

    // Verify audit log record
    const auditRecord = await testEnv.DB.prepare(
      `SELECT action, entity_type, entity_id, admin_id, details
       FROM audit_logs
       WHERE entity_id = ? AND action = 'staff.created'`
    )
      .bind(res.data.id)
      .first<{
        action: string;
        entity_type: string;
        entity_id: string;
        admin_id: string;
        details: string;
      }>();

    expect(auditRecord).not.toBeNull();
    expect(auditRecord!.admin_id).toBe(mainAdminId);
    expect(auditRecord!.entity_type).toBe("staff");
    const details = JSON.parse(auditRecord!.details);
    expect(details.username).toBe("alice_staff");
    expect(details.role).toBe("staff");
    expect(details.status).toBe("active");
    // Ensure passwords or hashes are NEVER in audit details
    expect(auditRecord!.details).not.toContain(rawPassword);
    expect(auditRecord!.details).not.toContain(dbRecord!.password_hash);
  });

  it("rejects staff creation with duplicate username (case-insensitive)", async () => {
    const res1 = await createStaff(testEnv, mainAdminId, {
      username: "bob_manager",
      password: "ValidPassword123!",
    });
    expect(res1.success).toBe(true);

    const res2 = await createStaff(testEnv, mainAdminId, {
      username: "BOB_MANAGER",
      password: "AnotherPassword123!",
    });
    expect(res2.success).toBe(false);
    if (!res2.success) {
      expect(res2.status).toBe(409);
      expect(res2.error).toContain("already exists");
    }
  });

  it("rejects staff creation with short or invalid passwords", async () => {
    const res = await createStaff(testEnv, mainAdminId, {
      username: "short_pass_user",
      password: "short",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("at least 12 characters");
    }
  });

  it("lists staff accounts distinguishing active, disabled and removed", async () => {
    const s1 = await createStaff(testEnv, mainAdminId, {
      username: "staff_active",
      password: "ValidPassword123!",
    });
    const s2 = await createStaff(testEnv, mainAdminId, {
      username: "staff_disabled",
      password: "ValidPassword123!",
    });
    const s3 = await createStaff(testEnv, mainAdminId, {
      username: "staff_removed",
      password: "ValidPassword123!",
    });

    expect(s1.success && s2.success && s3.success).toBe(true);
    if (!s1.success || !s2.success || !s3.success) return;

    await changeStaffStatus(testEnv, mainAdminId, s2.data.id, "deactivate");
    await changeStaffStatus(testEnv, mainAdminId, s3.data.id, "remove");

    const staffList = await listStaff(testEnv);
    expect(staffList.length).toBeGreaterThanOrEqual(3);

    const activeItem = staffList.find((s) => s.id === s1.data.id);
    const disabledItem = staffList.find((s) => s.id === s2.data.id);
    const removedItem = staffList.find((s) => s.id === s3.data.id);

    expect(activeItem?.status).toBe("active");
    expect(activeItem?.deleted_at).toBeNull();

    expect(disabledItem?.status).toBe("disabled");
    expect(disabledItem?.deleted_at).toBeNull();

    expect(removedItem?.status).toBe("disabled");
    expect(removedItem?.deleted_at).toBeTruthy();

    // Verify password hashes are never present
    for (const item of staffList) {
      expect((item as unknown as Record<string, unknown>).password_hash).toBeUndefined();
    }
  });

  it("deactivates a staff account, revokes sessions, and records audit event", async () => {
    // Create an active session for the staff member
    const session = await createSession(testEnv, staffAdminId);
    const sessionBefore = await getSession(testEnv, session.token);
    expect(sessionBefore).not.toBeNull();

    const result = await changeStaffStatus(
      testEnv,
      mainAdminId,
      staffAdminId,
      "deactivate",
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.status).toBe("disabled");
    expect(result.data.deleted_at).toBeNull();

    // Session must be purged immediately
    const sessionAfter = await getSession(testEnv, session.token);
    expect(sessionAfter).toBeNull();

    // Verify session row was deleted from sessions table
    const dbSessions = await testEnv.DB.prepare(
      "SELECT count(*) as count FROM sessions WHERE admin_id = ?"
    )
      .bind(staffAdminId)
      .first<{ count: number }>();
    expect(dbSessions?.count).toBe(0);

    // Verify audit log
    const audit = await testEnv.DB.prepare(
      `SELECT action, entity_type, entity_id FROM audit_logs WHERE entity_id = ? AND action = 'staff.deactivated'`
    )
      .bind(staffAdminId)
      .first<{ action: string }>();
    expect(audit).not.toBeNull();
  });

  it("soft-removes a staff account, revokes sessions, and prevents reactivation", async () => {
    const session = await createSession(testEnv, staffAdminId);

    const removeRes = await changeStaffStatus(
      testEnv,
      mainAdminId,
      staffAdminId,
      "remove",
    );
    expect(removeRes.success).toBe(true);
    if (!removeRes.success) return;

    expect(removeRes.data.status).toBe("disabled");
    expect(removeRes.data.deleted_at).toBeTruthy();

    // Session revoked
    const sessionAfter = await getSession(testEnv, session.token);
    expect(sessionAfter).toBeNull();

    // Soft deletion: account record still physically exists
    const dbRow = await testEnv.DB.prepare("SELECT id, deleted_at FROM admins WHERE id = ?")
      .bind(staffAdminId)
      .first<{ id: string; deleted_at: string }>();
    expect(dbRow).not.toBeNull();
    expect(dbRow?.deleted_at).toBeTruthy();

    // Attempting to activate a removed account MUST be rejected
    const reactivateRes = await changeStaffStatus(
      testEnv,
      mainAdminId,
      staffAdminId,
      "activate",
    );
    expect(reactivateRes.success).toBe(false);
    if (!reactivateRes.success) {
      expect(reactivateRes.status).toBe(400);
      expect(reactivateRes.error).toContain("removed account");
    }

    // Verify audit log
    const audit = await testEnv.DB.prepare(
      `SELECT action FROM audit_logs WHERE entity_id = ? AND action = 'staff.removed'`
    )
      .bind(staffAdminId)
      .first<{ action: string }>();
    expect(audit).not.toBeNull();
  });

  it("prevents self-deactivation and self-removal", async () => {
    const resDeact = await changeStaffStatus(
      testEnv,
      mainAdminId,
      mainAdminId,
      "deactivate",
    );
    expect(resDeact.success).toBe(false);
    if (!resDeact.success) {
      expect(resDeact.status).toBe(400);
      expect(resDeact.error).toContain("Self-deactivation");
    }

    const resRemove = await changeStaffStatus(
      testEnv,
      mainAdminId,
      mainAdminId,
      "remove",
    );
    expect(resRemove.success).toBe(false);
    if (!resRemove.success) {
      expect(resRemove.status).toBe(400);
      expect(resRemove.error).toContain("Self-deactivation");
    }
  });

  it("prevents disabling or removing the last active main_admin", async () => {
    // Create a secondary main admin acting as executor
    const executorAdminId = crypto.randomUUID();
    await testEnv.DB.prepare(
      `INSERT INTO admins (id, username, password_hash, role, status)
       VALUES (?, ?, 'hash', 'main_admin', 'active')`
    )
      .bind(executorAdminId, "executor_admin")
      .run();

    // Now disable one main admin so only mainAdminId remains
    await changeStaffStatus(testEnv, executorAdminId, executorAdminId, "deactivate").catch(() => {});
    await testEnv.DB.prepare("DELETE FROM admins WHERE id = ?").bind(executorAdminId).run();

    // Now mainAdminId is the solitary active main_admin
    // If someone targets mainAdminId from another context, it must be rejected
    const otherAdminId = crypto.randomUUID();
    const res = await changeStaffStatus(
      testEnv,
      otherAdminId,
      mainAdminId,
      "remove",
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("last active main administrator");
    }
  });

  it("ensures removed accounts cannot log in", async () => {
    const rawPass = "ValidPassword123!";
    const staff = await createStaff(testEnv, mainAdminId, {
      username: "removed_login_test",
      password: rawPass,
    });
    expect(staff.success).toBe(true);
    if (!staff.success) return;

    // Login succeeds initially
    const login1 = await loginAdmin(testEnv, "removed_login_test", rawPass);
    expect(login1.success).toBe(true);

    // Remove staff member
    await changeStaffStatus(testEnv, mainAdminId, staff.data.id, "remove");

    // Login must now fail
    const login2 = await loginAdmin(testEnv, "removed_login_test", rawPass);
    expect(login2.success).toBe(false);
    if (!login2.success) {
      expect(login2.message).toBe("Invalid username or password.");
    }
  });
});

describe("Staff Management Endpoints — HTTP & RBAC Integration", () => {
  it("allows Main Admin to list staff via GET /api/staff", async () => {
    const req = new Request("http://localhost:8787/api/staff", {
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
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("forbids Staff from listing staff via GET /api/staff (403)", async () => {
    const req = new Request("http://localhost:8787/api/staff", {
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

  it("allows Main Admin to create staff via POST /api/staff", async () => {
    const req = new Request("http://localhost:8787/api/staff", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "http://localhost:5173",
        Cookie: mainAdminCookie,
      },
      body: JSON.stringify({
        username: "new_staff_http",
        password: "HttpStaffPassword123!",
      }),
    });

    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.username).toBe("new_staff_http");
    expect(body.data.role).toBe("staff");
  });

  it("forbids Staff from creating staff via POST /api/staff (403)", async () => {
    const req = new Request("http://localhost:8787/api/staff", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "http://localhost:5173",
        Cookie: staffCookie,
      },
      body: JSON.stringify({
        username: "hacked_staff_by_staff",
        password: "SomePassword123!",
      }),
    });

    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toContain("Main Admin permission required");
  });

  it("allows Main Admin to execute lifecycle actions on staff", async () => {
    // 1. Deactivate
    const deactReq = new Request(
      `http://localhost:8787/api/staff/${staffAdminId}/deactivate`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Origin: "http://localhost:5173",
          Cookie: mainAdminCookie,
        },
      }
    );
    const deactRes = await worker.fetch(deactReq, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(deactRes.status).toBe(200);
    const deactBody = (await deactRes.json()) as any;
    expect(deactBody.data.status).toBe("disabled");

    // 2. Reactivate
    const actReq = new Request(
      `http://localhost:8787/api/staff/${staffAdminId}/activate`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Origin: "http://localhost:5173",
          Cookie: mainAdminCookie,
        },
      }
    );
    const actRes = await worker.fetch(actReq, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(actRes.status).toBe(200);
    const actBody = (await actRes.json()) as any;
    expect(actBody.data.status).toBe("active");

    // 3. Remove
    const remReq = new Request(
      `http://localhost:8787/api/staff/${staffAdminId}/remove`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Origin: "http://localhost:5173",
          Cookie: mainAdminCookie,
        },
      }
    );
    const remRes = await worker.fetch(remReq, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(remRes.status).toBe(200);
    const remBody = (await remRes.json()) as any;
    expect(remBody.data.status).toBe("disabled");
    expect(remBody.data.deleted_at).toBeTruthy();
  });

  it("forbids Staff from modifying staff status (403)", async () => {
    const req = new Request(
      `http://localhost:8787/api/staff/${staffAdminId}/deactivate`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Origin: "http://localhost:5173",
          Cookie: staffCookie,
        },
      }
    );
    const res = await worker.fetch(req, testEnv, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any);

    expect(res.status).toBe(403);
  });
});
