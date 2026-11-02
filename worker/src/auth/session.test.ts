
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:workers";

import {
    createSession,
    getSession,
    deleteSession,
    createSessionCookie,
    clearSessionCookie,
} from "./session";

import type { AppEnv } from "../types";

const testEnv = env as AppEnv;

let adminId: string;

beforeEach(async () => {
    adminId = crypto.randomUUID();

    await testEnv.DB.prepare(
        `INSERT INTO admins (id, username, password_hash, role)
     VALUES (?, ?, ?, ?)`,
    )
        .bind(adminId, `test_${adminId}`, "test-hash", "staff")
        .run();
});

afterEach(async () => {
    await testEnv.DB.prepare(
        "DELETE FROM sessions WHERE admin_id = ?",
    )
        .bind(adminId)
        .run();

    await testEnv.DB.prepare(
        "DELETE FROM admins WHERE id = ?",
    )
        .bind(adminId)
        .run();
});

describe("Session management", () => {
    it("creates a session with a valid random token", async () => {
        const session = await createSession(testEnv, adminId);

        expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("stores only the hashed session token in the database", async () => {
        const session = await createSession(testEnv, adminId);

        const stored = await testEnv.DB.prepare(
            "SELECT token_hash FROM sessions WHERE admin_id = ?",
        )
            .bind(adminId)
            .first<{ token_hash: string }>();

        expect(stored).not.toBeNull();
        expect(stored!.token_hash).not.toBe(session.token);
        expect(stored!.token_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("retrieves a valid session", async () => {
        const session = await createSession(testEnv, adminId);

        const result = await getSession(testEnv, session.token);

        expect(result).not.toBeNull();
        expect(result!.id).toBe(adminId);
        expect(result!.role).toBe("staff");
    });

    it("rejects an expired session", async () => {
        const session = await createSession(testEnv, adminId);

        await testEnv.DB.prepare(
            "UPDATE sessions SET expires_at = ? WHERE admin_id = ?",
        )
            .bind("2000-01-01T00:00:00.000Z", adminId)
            .run();

        const result = await getSession(testEnv, session.token);

        expect(result).toBeNull();
    });

    it("deletes a session successfully", async () => {
        const session = await createSession(testEnv, adminId);

        await deleteSession(testEnv, session.token);

        const result = await getSession(testEnv, session.token);

        expect(result).toBeNull();
    });

    it("rejects an invalid token format", async () => {
        const result = await getSession(testEnv, "invalid-token");

        expect(result).toBeNull();
    });
});

describe("Session cookies", () => {
    const validToken = "a".repeat(43);

    it("creates a secure session cookie", () => {
        const cookie = createSessionCookie(testEnv, validToken);

        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("Secure");
        expect(cookie).toContain("SameSite=Lax");
        expect(cookie).toContain("Path=/");
        expect(cookie).toContain("Max-Age=86400");
    });

    it("clears the session cookie", () => {
        const cookie = clearSessionCookie(testEnv);

        expect(cookie).toContain("tapme_session=");
        expect(cookie).toContain("Max-Age=0");
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("Secure");
    });
});
