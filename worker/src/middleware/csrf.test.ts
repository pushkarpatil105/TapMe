import { describe, it, expect } from "vitest";
import { checkCsrf } from "./csrf";
import type { AppEnv } from "../types";

const mockEnv = {
    ADMIN_ORIGINS: "http://localhost:5173,https://admin.tapme.example.com",
} as AppEnv;

function createRequest(
    method: string,
    origin?: string,
): Request {
    const headers = new Headers();

    if (origin !== undefined) {
        headers.set("Origin", origin);
    }

    return new Request("http://localhost:8787/api/test", {
        method,
        headers,
    });
}

describe("CSRF protection", () => {
    it("allows a trusted origin", () => {
        const request = createRequest("POST", "http://localhost:5173");

        expect(checkCsrf(request, mockEnv)).toBeNull();
    });

    it("allows a second configured trusted origin", () => {
        const request = createRequest("POST", "https://admin.tapme.example.com");

        expect(checkCsrf(request, mockEnv)).toBeNull();
    });

    it("rejects an untrusted origin", () => {
        const request = createRequest("POST", "https://evil.example");

        expect(checkCsrf(request, mockEnv)?.status).toBe(403);
    });

    it("rejects a missing origin", () => {
        const request = createRequest("POST");

        expect(checkCsrf(request, mockEnv)?.status).toBe(403);
    });

    it("rejects a malformed origin", () => {
        const request = createRequest("POST", "not-a-valid-origin");

        expect(checkCsrf(request, mockEnv)?.status).toBe(403);
    });

    it("does not block GET requests without an origin", () => {
        const request = createRequest("GET");

        expect(checkCsrf(request, mockEnv)).toBeNull();
    });

    it.each(["POST", "PUT", "PATCH", "DELETE"])(
        "rejects %s requests without an origin",
        (method) => {
            const request = createRequest(method);

            expect(checkCsrf(request, mockEnv)?.status).toBe(403);
        },
    );

    it("allows trusted origins for all state-changing methods", () => {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
            const request = createRequest(method, "http://localhost:5173");

            expect(checkCsrf(request, mockEnv)).toBeNull();
        }
    });

    it("rejects state-changing requests when ADMIN_ORIGINS contains wildcard *", () => {
        const wildcardEnv = {
            ADMIN_ORIGINS: "*",
        } as AppEnv;
        const request = createRequest("POST", "https://anywhere.com");

        expect(checkCsrf(request, wildcardEnv)?.status).toBe(403);
    });
});
