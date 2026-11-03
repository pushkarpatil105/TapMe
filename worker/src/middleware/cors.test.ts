import { describe, it, expect } from "vitest";
import { corsHeaders, handlePreflight, getAllowedOrigins } from "./cors";
import type { AppEnv } from "../types";

const mockEnv = {
  ADMIN_ORIGINS: "http://localhost:5173,https://admin.tapme.example.com",
} as AppEnv;

describe("CORS configuration & origin parsing", () => {
  it("parses single and multiple allowed origins", () => {
    const origins = getAllowedOrigins(mockEnv);
    expect(origins.has("http://localhost:5173")).toBe(true);
    expect(origins.has("https://admin.tapme.example.com")).toBe(true);
    expect(origins.size).toBe(2);
  });

  it("normalizes trailing slashes in allowed origins", () => {
    const env = {
      ADMIN_ORIGINS: "https://admin.tapme.example.com/",
    } as AppEnv;
    const origins = getAllowedOrigins(env);
    expect(origins.has("https://admin.tapme.example.com")).toBe(true);
  });

  it("strictly rejects wildcard origins", () => {
    const env1 = { ADMIN_ORIGINS: "*" } as AppEnv;
    expect(getAllowedOrigins(env1).size).toBe(0);

    const env2 = { ADMIN_ORIGINS: "https://*.example.com" } as AppEnv;
    expect(getAllowedOrigins(env2).size).toBe(0);

    const env3 = { ADMIN_ORIGINS: "http://localhost:5173,*" } as AppEnv;
    const origins3 = getAllowedOrigins(env3);
    expect(origins3.has("http://localhost:5173")).toBe(true);
    expect(origins3.has("*")).toBe(false);
    expect(origins3.size).toBe(1);
  });

  it("rejects invalid schemes and origins with credentials or paths", () => {
    const env = {
      ADMIN_ORIGINS:
        "ftp://example.com,https://user:pass@example.com,https://example.com/some/path",
    } as AppEnv;
    expect(getAllowedOrigins(env).size).toBe(0);
  });

  it("handles missing or undefined ADMIN_ORIGINS gracefully", () => {
    expect(getAllowedOrigins({} as AppEnv).size).toBe(0);
    expect(getAllowedOrigins({ ADMIN_ORIGINS: "" } as AppEnv).size).toBe(0);
  });
});

describe("CORS headers", () => {
  it("includes Content-Type and Accept in Access-Control-Allow-Headers", () => {
    const request = new Request("http://localhost:8787/api/test", {
      headers: { Origin: "http://localhost:5173" },
    });
    const headers = corsHeaders(request, mockEnv);

    expect(headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    expect(headers.get("Access-Control-Allow-Headers")).toContain("Accept");
    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(headers.get("Vary")).toBe("Origin");
  });

  it("does not set Access-Control-Allow-Origin for untrusted origin", () => {
    const request = new Request("http://localhost:8787/api/test", {
      headers: { Origin: "https://evil.attacker.org" },
    });
    const headers = corsHeaders(request, mockEnv);
    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("CORS preflight (OPTIONS)", () => {
  it("allows preflight for trusted origin with Content-Type and Accept", () => {
    const request = new Request("http://localhost:8787/api/cards", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, accept",
      },
    });

    const response = handlePreflight(request, mockEnv);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("allows preflight with only Accept header", () => {
    const request = new Request("http://localhost:8787/api/cards", {
      method: "OPTIONS",
      headers: {
        Origin: "https://admin.tapme.example.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "accept",
      },
    });

    const response = handlePreflight(request, mockEnv);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://admin.tapme.example.com",
    );
  });

  it("rejects preflight from untrusted origin with 403", () => {
    const request = new Request("http://localhost:8787/api/cards", {
      method: "OPTIONS",
      headers: {
        Origin: "https://malicious.site",
        "Access-Control-Request-Method": "POST",
      },
    });

    const response = handlePreflight(request, mockEnv);
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects preflight requesting unauthorized headers with 403", () => {
    const request = new Request("http://localhost:8787/api/cards", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, x-custom-evil-header",
      },
    });

    const response = handlePreflight(request, mockEnv);
    expect(response.status).toBe(403);
  });

  it("rejects preflight with unsupported HTTP method with 403", () => {
    const request = new Request("http://localhost:8787/api/cards", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "TRACE",
      },
    });

    const response = handlePreflight(request, mockEnv);
    expect(response.status).toBe(403);
  });

  it("rejects preflight when Origin header is missing with 403", () => {
    const request = new Request("http://localhost:8787/api/cards", {
      method: "OPTIONS",
      headers: {
        "Access-Control-Request-Method": "POST",
      },
    });

    const response = handlePreflight(request, mockEnv);
    expect(response.status).toBe(403);
  });
});
