import type { AppEnv } from "../types";
import { telemetry, type DiagnosticEvent } from "./telemetry";

export interface DatabaseHealthInfo {
  status: "operational" | "degraded" | "unavailable";
  duration_ms: number;
  last_check_at: string;
  error?: string;
}

export interface WorkerHealthInfo {
  status: "operational";
  environment: "development" | "production";
  version: string;
  uptime_reference: string;
}

export interface SystemHealthResponse {
  overall_status: "operational" | "degraded" | "unavailable";
  timestamp: string;
  worker: WorkerHealthInfo;
  database: DatabaseHealthInfo;
  redirect_monitoring: {
    total_recorded_scans: number;
    active_cards: number;
    unconfigured_cards: number;
    inactive_cards: number;
    archived_cards: number;
    failure_breakdown: {
      invalid_tokens: number;
      cards_not_found: number;
      unconfigured_scans: number;
      inactive_or_archived_scans: number;
    };
    last_redirect_error_at: string | null;
  };
  auth_monitoring: {
    active_admins_count: number;
    failed_login_attempts: number;
    rate_limit_rejections: number;
    auth_service_errors: number;
    last_auth_failure_at: string | null;
  };
  api_monitoring: {
    total_tracked_requests: number;
    csrf_rejections: number;
    forbidden_accesses: number;
    server_errors: number;
    last_error_at: string | null;
  };
  telemetry_notice: {
    scope: string;
    retention: string;
    notice: string;
  };
  recent_events: DiagnosticEvent[];
}

/**
 * Checks system health across Cloudflare Worker and D1 dependencies.
 * Only accessible to authenticated main_admin.
 */
export async function getSystemHealth(env: AppEnv): Promise<SystemHealthResponse> {
  const checkTimestamp = new Date().toISOString();
  const isDev = (env.ADMIN_ORIGINS || "").includes("localhost");

  // 1. Worker Health
  const workerHealth: WorkerHealthInfo = {
    status: "operational",
    environment: isDev ? "development" : "production",
    version: "1.0.0",
    uptime_reference: checkTimestamp,
  };

  // 2. Safe Database Connectivity & Latency Measurement
  let dbHealth: DatabaseHealthInfo;
  const dbStart = performance.now();

  try {
    const ping = await env.DB.prepare("SELECT 1 as ping").first<{ ping: number }>();
    const dbDuration = Math.round((performance.now() - dbStart) * 100) / 100;

    if (ping && ping.ping === 1) {
      dbHealth = {
        status: dbDuration > 200 ? "degraded" : "operational",
        duration_ms: dbDuration,
        last_check_at: checkTimestamp,
      };
    } else {
      dbHealth = {
        status: "degraded",
        duration_ms: dbDuration,
        last_check_at: checkTimestamp,
        error: "Database returned unexpected ping response.",
      };
    }
  } catch (err: unknown) {
    const dbDuration = Math.round((performance.now() - dbStart) * 100) / 100;
    const errorMsg = err instanceof Error ? err.message : "Unknown database error";
    dbHealth = {
      status: "unavailable",
      duration_ms: dbDuration,
      last_check_at: checkTimestamp,
      error: errorMsg,
    };
    telemetry.recordEvent("critical", "database", "db.error", "Database connectivity check failed", {
      error: errorMsg,
    });
  }

  // 3. Database Aggregated Counts (if DB is operational)
  let cardsCount = 0;
  let activeCards = 0;
  let unconfiguredCards = 0;
  let inactiveCards = 0;
  let archivedCards = 0;
  let totalScans = 0;
  let activeAdmins = 0;

  if (dbHealth.status !== "unavailable") {
    try {
      const counts = await env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM cards) as total_cards,
          (SELECT COUNT(*) FROM cards WHERE status = 'active') as active_cards,
          (SELECT COUNT(*) FROM cards WHERE status = 'active' AND configured_at IS NULL) as unconfigured_cards,
          (SELECT COUNT(*) FROM cards WHERE status = 'inactive') as inactive_cards,
          (SELECT COUNT(*) FROM cards WHERE status = 'archived') as archived_cards,
          (SELECT COUNT(*) FROM scan_events) as total_scans,
          (SELECT COUNT(*) FROM admins WHERE status = 'active' AND deleted_at IS NULL) as active_admins;`
      ).first<{
        total_cards: number;
        active_cards: number;
        unconfigured_cards: number;
        inactive_cards: number;
        archived_cards: number;
        total_scans: number;
        active_admins: number;
      }>();

      if (counts) {
        cardsCount = counts.total_cards || 0;
        activeCards = counts.active_cards || 0;
        unconfiguredCards = counts.unconfigured_cards || 0;
        inactiveCards = counts.inactive_cards || 0;
        archivedCards = counts.archived_cards || 0;
        totalScans = counts.total_scans || 0;
        activeAdmins = counts.active_admins || 0;
      }
    } catch (err: unknown) {
      console.error("Health query counts error:", err);
      // Non-fatal for counts query
    }
  }

  // 4. Resolve Overall System Status
  let overallStatus: "operational" | "degraded" | "unavailable" = "operational";
  if (dbHealth.status === "unavailable") {
    overallStatus = "unavailable";
  } else if (dbHealth.status === "degraded") {
    overallStatus = "degraded";
  }

  const summaries = telemetry.getSummaries();

  return {
    overall_status: overallStatus,
    timestamp: checkTimestamp,
    worker: workerHealth,
    database: dbHealth,
    redirect_monitoring: {
      total_recorded_scans: totalScans,
      active_cards: activeCards,
      unconfigured_cards: unconfiguredCards,
      inactive_cards: inactiveCards,
      archived_cards: archivedCards,
      failure_breakdown: {
        invalid_tokens: summaries.redirects.invalid_tokens,
        cards_not_found: summaries.redirects.cards_not_found,
        unconfigured_scans: summaries.redirects.unconfigured_cards,
        inactive_or_archived_scans: summaries.redirects.inactive_or_archived,
      },
      last_redirect_error_at: summaries.redirects.last_error_at,
    },
    auth_monitoring: {
      active_admins_count: activeAdmins,
      failed_login_attempts: summaries.auth.failed_login_attempts,
      rate_limit_rejections: summaries.auth.rate_limit_rejections,
      auth_service_errors: summaries.auth.auth_service_errors,
      last_auth_failure_at: summaries.auth.last_failure_at,
    },
    api_monitoring: {
      total_tracked_requests: summaries.api.total_requests,
      csrf_rejections: summaries.api.csrf_rejections,
      forbidden_accesses: summaries.api.forbidden_accesses,
      server_errors: summaries.api.server_errors,
      last_error_at: summaries.api.last_error_at,
    },
    telemetry_notice: {
      scope: "ephemeral_worker_isolate",
      retention: "temporary_in_memory_100_events",
      notice:
        "Diagnostics, redirect failure counts, and system event alerts are stored in a temporary in-memory ring buffer (up to 100 events) on the current Worker isolate. Data resets on isolate restart and is not shared across distributed edge isolates. Customer scan analytics are permanently stored in the D1 scan_events table.",
    },
    recent_events: telemetry.getRecentEvents(30),
  };
}

