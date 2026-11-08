import { describe, it, expect, beforeEach } from "vitest";
import { telemetry } from "./telemetry";
import { getSystemHealth } from "./diagnostics";
import { createSession } from "../auth/session";

describe("TapMe Phase 7 — Diagnostics & Telemetry Unit Tests", () => {
  beforeEach(() => {
    telemetry.resetForTesting();
  });

  describe("1. Telemetry Bounded Ring Buffer & Sanitization", () => {
    it("records events and evicts oldest when exceeding buffer limit (100)", () => {
      for (let i = 0; i < 110; i++) {
        telemetry.recordEvent("info", "system", "test.event", `Event message ${i}`);
      }

      const events = telemetry.getRecentEvents(150);
      expect(events.length).toBe(100);
      // Newest should be first (event 109)
      expect(events[0].message).toBe("Event message 109");
      // Oldest retained should be event 10
      expect(events[99].message).toBe("Event message 10");
    });

    it("strictly sanitizes passwords, hashes, peppers, and tokens from details", () => {
      telemetry.recordEvent("warning", "auth", "auth.failed", "Failed login", {
        username: "testadmin",
        password: "supersecretpassword123!",
        password_hash: "$2a$12$abcdef...",
        pepper: "secretpepper",
        token: "session_token_xyz",
        safeMetadata: "normal-value",
      });

      const events = telemetry.getRecentEvents(1);
      expect(events.length).toBe(1);
      const details = events[0].details as Record<string, unknown>;

      expect(details.username).toBe("testadmin");
      expect(details.safeMetadata).toBe("normal-value");
      expect(details.password).toBeUndefined();
      expect(details.password_hash).toBeUndefined();
      expect(details.pepper).toBeUndefined();
      expect(details.token).toBeUndefined();
    });

    it("tracks redirect failure and success categories correctly", () => {
      telemetry.recordRedirectMetric("invalid_token", { path: "/r/bad" });
      telemetry.recordRedirectMetric("card_not_found", { token: "missing123" });
      telemetry.recordRedirectMetric("unconfigured", { cardNumber: 5 });
      telemetry.recordRedirectMetric("inactive", { cardNumber: 6 });
      telemetry.recordRedirectMetric("success");
      telemetry.recordRedirectMetric("success");

      const summaries = telemetry.getSummaries().redirects;
      expect(summaries.invalid_tokens).toBe(1);
      expect(summaries.cards_not_found).toBe(1);
      expect(summaries.unconfigured_cards).toBe(1);
      expect(summaries.inactive_or_archived).toBe(1);
      expect(summaries.successful_redirects).toBe(2);
      expect(summaries.last_error_at).toBeDefined();
    });

    it("tracks authentication and API metrics without leakage", () => {
      telemetry.recordAuthMetric("failed_login", { usernamePrefix: "adm" });
      telemetry.recordAuthMetric("rate_limited", { usernamePrefix: "sta" });
      telemetry.recordApiMetric("csrf_rejected", { path: "/api/cards" });
      telemetry.recordApiMetric("forbidden", { path: "/api/staff" });

      const authSummary = telemetry.getSummaries().auth;
      const apiSummary = telemetry.getSummaries().api;

      expect(authSummary.failed_login_attempts).toBe(1);
      expect(authSummary.rate_limit_rejections).toBe(1);
      expect(apiSummary.csrf_rejections).toBe(1);
      expect(apiSummary.forbidden_accesses).toBe(1);
    });
  });

  describe("2. System Health Aggregator", () => {
    it("reports operational system health when D1 ping succeeds", async () => {
      const mockEnv = {
        ADMIN_ORIGINS: "http://localhost:5173",
        DB: {
          prepare: (sql: string) => ({
            bind: () => ({
              first: async () => {
                if (sql.includes("SELECT 1 as ping")) return { ping: 1 };
                return null;
              },
            }),
            first: async () => {
              if (sql.includes("SELECT 1 as ping")) return { ping: 1 };
              if (sql.includes("COUNT(*)")) {
                return {
                  total_cards: 10,
                  active_cards: 8,
                  unconfigured_cards: 2,
                  inactive_cards: 1,
                  archived_cards: 1,
                  total_scans: 45,
                  active_admins: 3,
                };
              }
              return null;
            },
          }),
        },
      } as any;

      const health = await getSystemHealth(mockEnv);

      expect(health.overall_status).toBe("operational");
      expect(health.worker.status).toBe("operational");
      expect(health.worker.environment).toBe("development");
      expect(health.database.status).toBe("operational");
      expect(health.database.duration_ms).toBeGreaterThanOrEqual(0);
      expect(health.redirect_monitoring.total_recorded_scans).toBe(45);
      expect(health.redirect_monitoring.active_cards).toBe(8);
      expect(health.redirect_monitoring.unconfigured_cards).toBe(2);
    });

    it("reports unavailable system health when D1 query throws", async () => {
      const mockEnv = {
        ADMIN_ORIGINS: "https://tapme.pages.dev",
        DB: {
          prepare: () => ({
            first: async () => {
              throw new Error("D1 connection lost");
            },
          }),
        },
      } as any;

      const health = await getSystemHealth(mockEnv);

      expect(health.overall_status).toBe("unavailable");
      expect(health.database.status).toBe("unavailable");
      expect(health.database.error).toBe("D1 connection lost");
      expect(health.worker.environment).toBe("production");
    });
  });
});

