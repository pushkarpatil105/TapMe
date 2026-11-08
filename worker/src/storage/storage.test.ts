import { describe, it, expect, beforeEach } from "vitest";
import {
  getStorageOverview,
  previewAuditCleanup,
  executeAuditCleanup,
  previewScanCleanup,
  executeScanCleanup,
  exportAuditLogsData,
  exportScanEventsData,
  sanitizeRecord,
} from "./storage";
import worker from "../index";
import { createSession } from "../auth/session";

describe("TapMe Phase 7 — Storage Management & Safe Retention Test Suite", () => {
  describe("1. Sensitive Data Sanitization", () => {
    it("recursively purges passwords, password hashes, peppers, and session tokens", () => {
      const sensitive = {
        id: "log-1",
        action: "staff.created",
        details: {
          username: "john_doe",
          password: "mysecretpassword123!",
          password_hash: "$2a$12$abc...",
          pepper: "topsecretpepper",
          session_token: "tok_12345",
          nested: {
            auth_token: "tok_nested",
            role: "staff",
          },
        },
      };

      const cleaned = sanitizeRecord(sensitive);
      expect(cleaned.details.username).toBe("john_doe");
      expect(cleaned.details.password).toBeUndefined();
      expect(cleaned.details.password_hash).toBeUndefined();
      expect(cleaned.details.pepper).toBeUndefined();
      expect(cleaned.details.session_token).toBeUndefined();
      expect(cleaned.details.nested.auth_token).toBeUndefined();
      expect(cleaned.details.nested.role).toBe("staff");
    });
  });

  describe("2. Storage Overview Aggregator", () => {
    it("reports exact row counts, payload byte sizes, and D1 quota explanations", async () => {
      const mockEnv = {
        DB: {
          prepare: (sql: string) => ({
            first: async () => {
              if (sql.includes("as audit_count")) {
                return {
                  audit_count: 50,
                  scan_count: 200,
                  card_count: 15,
                  link_count: 25,
                  session_count: 2,
                  admin_count: 3,
                };
              }
              if (sql.includes("FROM audit_logs")) return { bytes: 12500 };
              if (sql.includes("FROM scan_events")) return { bytes: 24000 };
              if (sql.includes("FROM cards")) return { bytes: 3200 };
              return null;
            },
          }),
        },
      } as any;

      const overview = await getStorageOverview(mockEnv);

      expect(overview.counts.audit_logs).toBe(50);
      expect(overview.counts.scan_events).toBe(200);
      expect(overview.counts.cards).toBe(15);
      expect(overview.payload_sizes_bytes.audit_logs).toBe(12500);
      expect(overview.formatted_payload_sizes.audit_logs).toBe("12.21 KB");
      expect(overview.d1_limits.tier_quota_bytes).toBe(524288000);
      expect(overview.measurement_metadata.unmeasurable_metrics[0]).toContain("PRAGMA page_count is disallowed");
      expect(overview.measurement_metadata.disk_vs_ram_notice).toContain("D1 database storage is persistent disk storage");
    });
  });

  describe("3. Audit Cleanup Workflow & Safety Rules", () => {
    it("previews audit records eligible for deletion", async () => {
      const cutoff = "2026-10-01T00:00:00.000Z";
      const mockEnv = {
        DB: {
          prepare: (sql: string) => ({
            bind: (param: string) => ({
              first: async () => {
                if (sql.includes("created_at < ?") && sql.includes("COUNT(*)")) {
                  return { count: 35 };
                }
                if (sql.includes("created_at >= ?") && sql.includes("COUNT(*)")) {
                  return { count: 15 };
                }
                if (sql.includes("MIN(created_at)")) {
                  return { oldest: "2026-08-15 10:00:00", newest: "2026-09-30 23:50:00" };
                }
                return null;
              },
            }),
          }),
        },
      } as any;

      const preview = await previewAuditCleanup(mockEnv, cutoff);
      expect(preview.cutoff).toBe(cutoff);
      expect(preview.records_to_delete).toBe(35);
      expect(preview.records_to_retain).toBe(15);
      expect(preview.oldest_affected_record).toBe("2026-08-15 10:00:00");
    });

    it("rejects invalid cutoff date formats", async () => {
      const mockEnv = {} as any;
      const admin = { id: "admin-1", username: "superadmin" };

      await expect(
        executeAuditCleanup(mockEnv, admin, "invalid-date-string")
      ).rejects.toThrow("Invalid cutoff date format.");
    });

    it("safely deletes records older than cutoff and preserves a surviving audit cleanup record", async () => {
      const cutoff = "2026-10-01T00:00:00.000Z";
      let deleteCalledWith: string | null = null;
      let auditInsertedAction: string | null = null;

      const mockEnv = {
        DB: {
          prepare: (sql: string) => ({
            bind: (...args: any[]) => ({
              first: async () => {
                if (sql.includes("created_at < ?") && sql.includes("COUNT(*)")) {
                  return { count: 20 };
                }
                return null;
              },
              run: async () => {
                if (sql.includes("DELETE FROM audit_logs")) {
                  deleteCalledWith = args[0];
                }
                if (sql.includes("INSERT INTO audit_logs")) {
                  auditInsertedAction = "audit.cleanup";
                }
                return { success: true };
              },
            }),
            first: async () => {
              if (sql.includes("SELECT COUNT(*) as count FROM audit_logs")) {
                return { count: 5 };
              }
              return null;
            },
          }),
        },
      } as any;

      const admin = { id: "admin-1", username: "superadmin" };
      const result = await executeAuditCleanup(mockEnv, admin, cutoff);

      expect(result.success).toBe(true);
      expect(result.deleted_count).toBe(20);
      expect(result.remaining_count).toBe(5);
      expect(deleteCalledWith).toBe(cutoff);
      expect(auditInsertedAction).toBe("audit.cleanup");
    });

    it("safely deletes scan events older than cutoff without touching cards or links", async () => {
      const cutoff = "2026-10-01T00:00:00.000Z";
      let deleteCalledWith: string | null = null;
      let auditInsertedAction: string | null = null;

      const mockEnv = {
        DB: {
          prepare: (sql: string) => ({
            bind: (...args: any[]) => ({
              first: async () => {
                if (sql.includes("scanned_at < ?") && sql.includes("COUNT(*)")) {
                  return { count: 50 };
                }
                return null;
              },
              run: async () => {
                if (sql.includes("DELETE FROM scan_events")) {
                  deleteCalledWith = args[0];
                }
                if (sql.includes("INSERT INTO audit_logs")) {
                  auditInsertedAction = "scan.cleanup";
                }
                return { success: true };
              },
            }),
            first: async () => {
              if (sql.includes("SELECT COUNT(*) as count FROM scan_events")) {
                return { count: 10 };
              }
              return null;
            },
          }),
        },
      } as any;

      const admin = { id: "admin-1", username: "superadmin" };
      const result = await executeScanCleanup(mockEnv, admin, cutoff);

      expect(result.success).toBe(true);
      expect(result.deleted_count).toBe(50);
      expect(result.remaining_count).toBe(10);
      expect(deleteCalledWith).toBe(cutoff);
      expect(auditInsertedAction).toBe("scan.cleanup");
    });
  });

  describe("4. Audit Logs Export Formats (CSV & JSON)", () => {
    const sampleRows = [
      {
        id: "log-1",
        admin_id: "admin-1",
        admin_username: "alice_admin",
        action: "card.created",
        entity_type: "card",
        entity_id: "6",
        details: JSON.stringify({ qr_type: "instagram", card_number: 6 }),
        created_at: "2026-11-06 10:00:00",
      },
    ];

    it("generates structured JSON export with sanitized details and original timestamps", async () => {
      const mockEnv = {
        DB: {
          prepare: () => ({
            bind: () => ({
              all: async () => ({ results: sampleRows }),
            }),
          }),
        },
      } as any;

      const exportResult = await exportAuditLogsData(mockEnv, { format: "json" });
      expect(exportResult.contentType).toBe("application/json");
      expect(exportResult.filename).toMatch(/^tapme-audit-logs-.*\.json$/);

      const parsed = JSON.parse(exportResult.data);
      expect(parsed.record_count).toBe(1);
      expect(parsed.logs[0].action).toBe("card.created");
      expect(parsed.logs[0].actor_username).toBe("alice_admin");
      expect(parsed.logs[0].details.qr_type).toBe("instagram");
    });

    it("generates RFC 4180 compliant CSV export with UTC and IST timestamps and extracted business metadata", async () => {
      const mockEnv = {
        DB: {
          prepare: () => ({
            bind: () => ({
              all: async () => ({ results: sampleRows }),
            }),
          }),
        },
      } as any;

      const exportResult = await exportAuditLogsData(mockEnv, { format: "csv" });
      expect(exportResult.contentType).toBe("text/csv; charset=utf-8");
      expect(exportResult.filename).toMatch(/^tapme-audit-logs-.*\.csv$/);

      const lines = exportResult.data.split("\r\n");
      expect(lines[0]).toBe('"Log ID","Timestamp (UTC)","Timestamp (IST)","Actor Username","Actor ID","Action","Entity Type","Card Number","Business Name","Summary","Details (JSON)"');
      expect(lines[1]).toContain('"log-1"');
      expect(lines[1]).toContain('"alice_admin"');
      expect(lines[1]).toContain('"card.created"');
      expect(lines[1]).toContain('"#006"');
      expect(lines[1]).toContain('"Card created"');
    });

    it("generates RFC 4180 compliant CSV export for scan events", async () => {
      const scanRows = [
        {
          id: "scan-1",
          card_number: 6,
          scanned_at: "2026-11-06 10:00:00",
          user_agent: "Mozilla/5.0",
          referrer: "https://instagram.com",
        },
      ];

      const mockEnv = {
        DB: {
          prepare: () => ({
            bind: () => ({
              all: async () => ({ results: scanRows }),
            }),
          }),
        },
      } as any;

      const exportResult = await exportScanEventsData(mockEnv, { format: "csv" });
      expect(exportResult.contentType).toBe("text/csv; charset=utf-8");
      const lines = exportResult.data.split("\r\n");
      expect(lines[0]).toBe('"Scan ID","Card Number","Scanned At (UTC)","Scanned At (IST)","User Agent","Referrer"');
      expect(lines[1]).toContain('"#006"');
      expect(lines[1]).toContain('"https://instagram.com"');
    });
  });

  describe("5. RBAC Integration on Phase 7 Endpoints", () => {
    it("forbids staff members from accessing system health or storage (403)", async () => {
      // Mock staff session
      const staffSession = {
        id: "staff-1",
        username: "staff_member",
        role: "staff",
        status: "active",
      };

      const mockEnv = {
        ADMIN_ORIGINS: "http://localhost:5173",
        COOKIE_NAME: "tapme_session",
        COOKIE_SAME_SITE: "Lax",
        DB: {
          prepare: (sql: string) => ({
            bind: () => ({
              first: async () => {
                if (sql.includes("FROM sessions")) {
                  return {
                    id: staffSession.id,
                    username: staffSession.username,
                    role: staffSession.role,
                    status: staffSession.status,
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                  };
                }
                return null;
              },
            }),
          }),
        },
      } as any;

      const endpoints = [
        "/api/system/health",
        "/api/system/storage",
        "/api/system/export/audit-logs",
        "/api/system/cleanup/audit/preview?cutoff=2026-10-01",
      ];

      const valid43CharToken = "a".repeat(43);

      for (const endpoint of endpoints) {
        const req = new Request(`http://localhost:8787${endpoint}`, {
          method: "GET",
          headers: {
            Cookie: `tapme_session=${valid43CharToken}`,
            Origin: "http://localhost:5173",
          },
        });

        const res = await worker.fetch(req, mockEnv, {} as any);
        expect(res.status).toBe(403);
      }
    });
  });
});
