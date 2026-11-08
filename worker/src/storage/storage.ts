import type { AppEnv } from "../types";
import { telemetry } from "../diagnostics/telemetry";

export interface StorageOverviewResponse {
  counts: {
    audit_logs: number;
    scan_events: number;
    cards: number;
    card_links: number;
    sessions: number;
    admins: number;
  };
  payload_sizes_bytes: {
    audit_logs: number;
    scan_events: number;
    cards: number;
    total_measured_payload_bytes: number;
  };
  formatted_payload_sizes: {
    audit_logs: string;
    scan_events: string;
    cards: string;
    total_measured: string;
  };
  d1_limits: {
    tier_quota_bytes: number; // 500 MB (524,288,000 bytes) on free tier
    tier_quota_label: string;
  };
  measurement_metadata: {
    measured_metrics: string[];
    unmeasurable_metrics: string[];
    disk_vs_ram_notice: string;
  };
}

export interface CleanupPreview {
  cutoff: string;
  records_to_delete: number;
  records_to_retain: number;
  oldest_affected_record: string | null;
  newest_affected_record: string | null;
}

export interface CleanupResult {
  success: boolean;
  deleted_count: number;
  remaining_count: number;
  cutoff: string;
  cleanup_audit_id: string;
}

let isAuditCleanupInProgress = false;
let isScanCleanupInProgress = false;

/**
 * Formats a UTC ISO/SQLite timestamp into Indian Standard Time (Asia/Kolkata).
 */
export function formatIstDateTime(utcString: string | null | undefined): string {
  if (!utcString) return "—";
  try {
    const trimmed = String(utcString).trim();
    let dateToParse = trimmed;
    const hasTz = /Z$/i.test(trimmed) || /[+-]\d{2}(?::?\d{2})?$/.test(trimmed);
    if (!hasTz) {
      dateToParse = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)
        ? `${trimmed.replace(" ", "T")}Z`
        : `${trimmed}Z`;
    }
    const d = new Date(dateToParse);
    if (isNaN(d.getTime())) return trimmed;
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return String(utcString);
  }
}

/**
 * Strips sensitive keys recursively from any data object.
 */
export function sanitizeRecord<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeRecord(item)) as unknown as T;
  }

  const isSensitiveKey = (key: string) => {
    const lower = key.toLowerCase();
    return (
      lower.includes("password") ||
      lower.includes("hash") ||
      lower.includes("pepper") ||
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("session") ||
      lower.includes("cookie") ||
      lower.includes("authorization")
    );
  };

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      continue;
    }
    if (value !== null && typeof value === "object") {
      sanitized[key] = sanitizeRecord(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}

/**
 * Formats byte counts into human-readable strings (B, KB, MB).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Retrieves storage consumption overview for the D1 database.
 */
export async function getStorageOverview(env: AppEnv): Promise<StorageOverviewResponse> {
  // 1. Exact Row Counts
  const counts = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM audit_logs) as audit_count,
      (SELECT COUNT(*) FROM scan_events) as scan_count,
      (SELECT COUNT(*) FROM cards) as card_count,
      (SELECT COUNT(*) FROM card_links) as link_count,
      (SELECT COUNT(*) FROM sessions) as session_count,
      (SELECT COUNT(*) FROM admins) as admin_count;`
  ).first<{
    audit_count: number;
    scan_count: number;
    card_count: number;
    link_count: number;
    session_count: number;
    admin_count: number;
  }>();

  // 2. Raw Payload Sizes (Sum of column byte lengths)
  const auditBytesRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(length(id) + length(action) + length(entity_type) + COALESCE(length(entity_id),0) + COALESCE(length(details),0) + length(created_at)), 0) as bytes FROM audit_logs;`
  ).first<{ bytes: number }>();

  const scanBytesRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(length(id) + 8 + length(scanned_at) + COALESCE(length(user_agent),0) + COALESCE(length(referrer),0)), 0) as bytes FROM scan_events;`
  ).first<{ bytes: number }>();

  const cardBytesRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(8 + length(public_token) + length(business_name) + COALESCE(length(location),0) + length(status) + length(qr_type)), 0) as bytes FROM cards;`
  ).first<{ bytes: number }>();

  const auditBytes = auditBytesRow?.bytes || 0;
  const scanBytes = scanBytesRow?.bytes || 0;
  const cardBytes = cardBytesRow?.bytes || 0;
  const totalMeasured = auditBytes + scanBytes + cardBytes;

  return {
    counts: {
      audit_logs: counts?.audit_count || 0,
      scan_events: counts?.scan_count || 0,
      cards: counts?.card_count || 0,
      card_links: counts?.link_count || 0,
      sessions: counts?.session_count || 0,
      admins: counts?.admin_count || 0,
    },
    payload_sizes_bytes: {
      audit_logs: auditBytes,
      scan_events: scanBytes,
      cards: cardBytes,
      total_measured_payload_bytes: totalMeasured,
    },
    formatted_payload_sizes: {
      audit_logs: formatBytes(auditBytes),
      scan_events: formatBytes(scanBytes),
      cards: formatBytes(cardBytes),
      total_measured: formatBytes(totalMeasured),
    },
    d1_limits: {
      tier_quota_bytes: 524288000, // 500 MB Free Tier
      tier_quota_label: "500 MB (Cloudflare D1 Free Tier)",
    },
    measurement_metadata: {
      measured_metrics: [
        "Exact table row counts via COUNT(*)",
        "Raw data payload byte size via column length sums",
      ],
      unmeasurable_metrics: [
        "Physical SQLite file size on disk (PRAGMA page_count is disallowed by Cloudflare D1 with SQLITE_AUTH)",
        "Freelist fragmentation pages (managed internally by Cloudflare storage engine)",
      ],
      disk_vs_ram_notice:
        "D1 database storage is persistent disk storage. Deleting historical records reclaims logical space in SQLite's freelist for future writes, but does not alter Cloudflare Worker ephemeral RAM (128 MB limit).",
    },
  };
}

/**
 * Previews records eligible for audit cleanup based on cutoff date.
 */
export async function previewAuditCleanup(env: AppEnv, cutoffIso: string): Promise<CleanupPreview> {
  const cutoffDate = new Date(cutoffIso);
  if (isNaN(cutoffDate.getTime())) {
    throw new Error("Invalid cutoff date format. Must be an ISO timestamp.");
  }
  const cutoffStr = cutoffDate.toISOString();

  const toDeleteRow = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM audit_logs WHERE created_at < ?"
  )
    .bind(cutoffStr)
    .first<{ count: number }>();

  const toRetainRow = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM audit_logs WHERE created_at >= ?"
  )
    .bind(cutoffStr)
    .first<{ count: number }>();

  const rangeRow = await env.DB.prepare(
    "SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM audit_logs WHERE created_at < ?"
  )
    .bind(cutoffStr)
    .first<{ oldest: string | null; newest: string | null }>();

  return {
    cutoff: cutoffStr,
    records_to_delete: toDeleteRow?.count || 0,
    records_to_retain: toRetainRow?.count || 0,
    oldest_affected_record: rangeRow?.oldest || null,
    newest_affected_record: rangeRow?.newest || null,
  };
}

/**
 * Safely executes audit log cleanup with mandatory audit trail preservation.
 * Includes concurrency protection against overlapping cleanup requests.
 */
export async function executeAuditCleanup(
  env: AppEnv,
  admin: { id: string; username: string },
  cutoffIso: string
): Promise<CleanupResult> {
  if (isAuditCleanupInProgress) {
    throw new Error("An audit cleanup operation is currently in progress. Please wait.");
  }

  isAuditCleanupInProgress = true;
  try {
    const cutoffDate = new Date(cutoffIso);
    if (isNaN(cutoffDate.getTime())) {
      throw new Error("Invalid cutoff date format.");
    }
    const cutoffStr = cutoffDate.toISOString();

    // Revalidate count before deletion
    const eligibleRow = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM audit_logs WHERE created_at < ?"
    )
      .bind(cutoffStr)
      .first<{ count: number }>();

    const toDelete = eligibleRow?.count || 0;

    if (toDelete === 0) {
      const remainingRow = await env.DB.prepare("SELECT COUNT(*) as count FROM audit_logs").first<{
        count: number;
      }>();
      return {
        success: true,
        deleted_count: 0,
        remaining_count: remainingRow?.count || 0,
        cutoff: cutoffStr,
        cleanup_audit_id: "none",
      };
    }

    // Perform deletion
    await env.DB.prepare("DELETE FROM audit_logs WHERE created_at < ?").bind(cutoffStr).run();

    // Create audit trail record documenting cleanup (created_at = CURRENT_TIMESTAMP > cutoff, so it survives)
    const auditId = crypto.randomUUID();
    const cleanupDetails = JSON.stringify({
      cutoff: cutoffStr,
      deleted_count: toDelete,
      actor_id: admin.id,
      actor_username: admin.username,
      action_note: "Historical audit records safely deleted under admin retention management.",
    });

    await env.DB.prepare(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, 'audit.cleanup', 'system', 'audit_logs', ?, CURRENT_TIMESTAMP)`
    )
      .bind(auditId, admin.id, cleanupDetails)
      .run();

    // Query updated remaining count
    const remainingRow = await env.DB.prepare("SELECT COUNT(*) as count FROM audit_logs").first<{
      count: number;
    }>();

    telemetry.recordEvent(
      "info",
      "system",
      "cleanup.audit",
      `Audit cleanup executed by ${admin.username}: deleted ${toDelete} records older than ${cutoffStr}`,
      { cutoff: cutoffStr, deleted_count: toDelete }
    );

    return {
      success: true,
      deleted_count: toDelete,
      remaining_count: remainingRow?.count || 0,
      cutoff: cutoffStr,
      cleanup_audit_id: auditId,
    };
  } finally {
    isAuditCleanupInProgress = false;
  }
}

/**
 * Previews scan events eligible for cleanup.
 */
export async function previewScanCleanup(env: AppEnv, cutoffIso: string): Promise<CleanupPreview> {
  const cutoffDate = new Date(cutoffIso);
  if (isNaN(cutoffDate.getTime())) {
    throw new Error("Invalid cutoff date format. Must be an ISO timestamp.");
  }
  const cutoffStr = cutoffDate.toISOString();

  const toDeleteRow = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM scan_events WHERE scanned_at < ?"
  )
    .bind(cutoffStr)
    .first<{ count: number }>();

  const toRetainRow = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM scan_events WHERE scanned_at >= ?"
  )
    .bind(cutoffStr)
    .first<{ count: number }>();

  const rangeRow = await env.DB.prepare(
    "SELECT MIN(scanned_at) as oldest, MAX(scanned_at) as newest FROM scan_events WHERE scanned_at < ?"
  )
    .bind(cutoffStr)
    .first<{ oldest: string | null; newest: string | null }>();

  return {
    cutoff: cutoffStr,
    records_to_delete: toDeleteRow?.count || 0,
    records_to_retain: toRetainRow?.count || 0,
    oldest_affected_record: rangeRow?.oldest || null,
    newest_affected_record: rangeRow?.newest || null,
  };
}

/**
 * Safely executes scan event cleanup.
 * Strictly deletes from scan_events ONLY; cards and destination links are never altered.
 * Protected against concurrent cleanup requests.
 */
export async function executeScanCleanup(
  env: AppEnv,
  admin: { id: string; username: string },
  cutoffIso: string
): Promise<CleanupResult> {
  if (isScanCleanupInProgress) {
    throw new Error("A scan cleanup operation is currently in progress. Please wait.");
  }

  isScanCleanupInProgress = true;
  try {
    const cutoffDate = new Date(cutoffIso);
    if (isNaN(cutoffDate.getTime())) {
      throw new Error("Invalid cutoff date format.");
    }
    const cutoffStr = cutoffDate.toISOString();

    const eligibleRow = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM scan_events WHERE scanned_at < ?"
    )
      .bind(cutoffStr)
      .first<{ count: number }>();

    const toDelete = eligibleRow?.count || 0;

    if (toDelete === 0) {
      const remainingRow = await env.DB.prepare("SELECT COUNT(*) as count FROM scan_events").first<{
        count: number;
      }>();
      return {
        success: true,
        deleted_count: 0,
        remaining_count: remainingRow?.count || 0,
        cutoff: cutoffStr,
        cleanup_audit_id: "none",
      };
    }

    // Delete scan events ONLY (never cards or destination links)
    await env.DB.prepare("DELETE FROM scan_events WHERE scanned_at < ?").bind(cutoffStr).run();

    // Record operation in audit_logs
    const auditId = crypto.randomUUID();
    const cleanupDetails = JSON.stringify({
      cutoff: cutoffStr,
      deleted_count: toDelete,
      actor_id: admin.id,
      actor_username: admin.username,
      action_note: "Historical scan events safely deleted under admin retention management.",
    });

    await env.DB.prepare(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, 'scan.cleanup', 'system', 'scan_events', ?, CURRENT_TIMESTAMP)`
    )
      .bind(auditId, admin.id, cleanupDetails)
      .run();

    const remainingRow = await env.DB.prepare("SELECT COUNT(*) as count FROM scan_events").first<{
      count: number;
    }>();

    telemetry.recordEvent(
      "info",
      "system",
      "cleanup.scans",
      `Scan event cleanup executed by ${admin.username}: deleted ${toDelete} records older than ${cutoffStr}`,
      { cutoff: cutoffStr, deleted_count: toDelete }
    );

    return {
      success: true,
      deleted_count: toDelete,
      remaining_count: remainingRow?.count || 0,
      cutoff: cutoffStr,
      cleanup_audit_id: auditId,
    };
  } finally {
    isScanCleanupInProgress = false;
  }
}

/**
 * Exports audit logs for CSV or JSON download with full data sanitization.
 */
export async function exportAuditLogsData(
  env: AppEnv,
  options: {
    format: "csv" | "json";
    cutoff?: string;
    startDate?: string;
    endDate?: string;
    action?: string;
  }
): Promise<{ data: string; contentType: string; filename: string }> {
  let whereClauses: string[] = [];
  let params: unknown[] = [];

  if (options.cutoff) {
    whereClauses.push("audit_logs.created_at < ?");
    params.push(new Date(options.cutoff).toISOString());
  }

  if (options.startDate) {
    whereClauses.push("audit_logs.created_at >= ?");
    params.push(options.startDate);
  }

  if (options.endDate) {
    whereClauses.push("audit_logs.created_at <= ?");
    params.push(`${options.endDate} 23:59:59`);
  }

  if (options.action) {
    whereClauses.push("audit_logs.action = ?");
    params.push(options.action);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const sql = `
    SELECT
      audit_logs.id,
      audit_logs.admin_id,
      admins.username as admin_username,
      audit_logs.action,
      audit_logs.entity_type,
      audit_logs.entity_id,
      audit_logs.details,
      audit_logs.created_at
    FROM audit_logs
    LEFT JOIN admins ON audit_logs.admin_id = admins.id
    ${whereSql}
    ORDER BY audit_logs.created_at ASC
    LIMIT 10000;
  `;

  const rows = await env.DB.prepare(sql)
    .bind(...params)
    .all<{
      id: string;
      admin_id: string;
      admin_username: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      details: string | null;
      created_at: string;
    }>();

  const sanitizedRows = (rows.results || []).map((row) => {
    let parsedDetails: unknown = null;
    if (row.details) {
      try {
        parsedDetails = JSON.parse(row.details);
      } catch {
        parsedDetails = row.details;
      }
    }

    return {
      id: row.id,
      created_at_utc: row.created_at,
      actor_username: row.admin_username || "System",
      actor_id: row.admin_id,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      details: sanitizeRecord(parsedDetails),
    };
  });

  const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");

  if (options.format === "json") {
    return {
      data: JSON.stringify(
        {
          export_generated_at_utc: new Date().toISOString(),
          record_count: sanitizedRows.length,
          filter: {
            cutoff: options.cutoff || null,
            startDate: options.startDate || null,
            endDate: options.endDate || null,
            action: options.action || null,
          },
          logs: sanitizedRows,
        },
        null,
        2
      ),
      contentType: "application/json",
      filename: `tapme-audit-logs-${timestampStr}.json`,
    };
  }

  // CSV formatting (RFC 4180 compliant)
  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    const str = typeof val === "object" ? JSON.stringify(val) : String(val);
    return `"${str.replace(/"/g, '""')}"`;
  };

  const csvHeaders = [
    "Log ID",
    "Timestamp (UTC)",
    "Timestamp (IST)",
    "Actor Username",
    "Actor ID",
    "Action",
    "Entity Type",
    "Card Number",
    "Business Name",
    "Summary",
    "Details (JSON)",
  ];

  const csvRows = sanitizedRows.map((row) => {
    const detailsObj = (row.details && typeof row.details === "object" ? row.details : {}) as Record<string, unknown>;

    let cardNumber = "";
    if (row.entity_type === "card" && row.entity_id) {
      cardNumber = /^\d+$/.test(row.entity_id)
        ? `#${String(row.entity_id).padStart(3, "0")}`
        : String(row.entity_id);
    } else if (detailsObj.card_number != null) {
      cardNumber = `#${String(detailsObj.card_number).padStart(3, "0")}`;
    }

    let businessName = "";
    if (typeof detailsObj.business_name === "string" && detailsObj.business_name.trim()) {
      businessName = detailsObj.business_name.trim();
    } else if (
      detailsObj.changes &&
      typeof detailsObj.changes === "object" &&
      (detailsObj.changes as Record<string, any>).business_name?.after
    ) {
      businessName = String((detailsObj.changes as Record<string, any>).business_name.after).trim();
    }

    let summary = row.action;
    switch (row.action) {
      case "card.created":
        summary = "Card created";
        break;
      case "card.configured":
        summary = "Card configured with destination links";
        break;
      case "card.updated":
        summary = "Card modified";
        break;
      case "card.activated":
        summary = "Card activated";
        break;
      case "card.deactivated":
        summary = "Card deactivated";
        break;
      case "card.archived":
        summary = "Card archived";
        break;
      case "card.restored":
        summary = "Card restored from archive";
        break;
      case "staff.created":
        summary = "Staff account created";
        break;
      case "staff.activated":
        summary = "Staff account activated";
        break;
      case "staff.deactivated":
        summary = "Staff account deactivated";
        break;
      case "staff.removed":
        summary = "Staff account removed";
        break;
      case "audit.cleanup":
        summary = "Audit retention cleanup executed";
        break;
      case "scan.cleanup":
        summary = "Scan events retention cleanup executed";
        break;
    }

    return [
      escapeCsv(row.id),
      escapeCsv(row.created_at_utc),
      escapeCsv(formatIstDateTime(row.created_at_utc)),
      escapeCsv(row.actor_username),
      escapeCsv(row.actor_id),
      escapeCsv(row.action),
      escapeCsv(row.entity_type),
      escapeCsv(cardNumber),
      escapeCsv(businessName),
      escapeCsv(summary),
      escapeCsv(row.details),
    ];
  });

  const csvContent = [
    csvHeaders.map(escapeCsv).join(","),
    ...csvRows.map((cols) => cols.join(",")),
  ].join("\r\n");

  return {
    data: csvContent,
    contentType: "text/csv; charset=utf-8",
    filename: `tapme-audit-logs-${timestampStr}.csv`,
  };
}

/**
 * Exports scan events for CSV or JSON download.
 */
export async function exportScanEventsData(
  env: AppEnv,
  options: {
    format: "csv" | "json";
    cutoff?: string;
    startDate?: string;
    endDate?: string;
  }
): Promise<{ data: string; contentType: string; filename: string }> {
  let whereClauses: string[] = [];
  let params: unknown[] = [];

  if (options.cutoff) {
    whereClauses.push("scanned_at < ?");
    params.push(new Date(options.cutoff).toISOString());
  }

  if (options.startDate) {
    whereClauses.push("scanned_at >= ?");
    params.push(options.startDate);
  }

  if (options.endDate) {
    whereClauses.push("scanned_at <= ?");
    params.push(`${options.endDate} 23:59:59`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const rows = await env.DB.prepare(
    `SELECT id, card_number, scanned_at, user_agent, referrer
     FROM scan_events
     ${whereSql}
     ORDER BY scanned_at ASC
     LIMIT 10000;`
  )
    .bind(...params)
    .all<{
      id: string;
      card_number: number;
      scanned_at: string;
      user_agent: string | null;
      referrer: string | null;
    }>();

  const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");

  if (options.format === "json") {
    return {
      data: JSON.stringify(
        {
          export_generated_at_utc: new Date().toISOString(),
          record_count: (rows.results || []).length,
          events: rows.results || [],
        },
        null,
        2
      ),
      contentType: "application/json",
      filename: `tapme-scan-events-${timestampStr}.json`,
    };
  }

  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    return `"${String(val).replace(/"/g, '""')}"`;
  };

  const csvHeaders = [
    "Scan ID",
    "Card Number",
    "Scanned At (UTC)",
    "Scanned At (IST)",
    "User Agent",
    "Referrer",
  ];
  const csvRows = (rows.results || []).map((row) => [
    escapeCsv(row.id),
    escapeCsv(
      /^[0-9]+$/.test(String(row.card_number))
        ? `#${String(row.card_number).padStart(3, "0")}`
        : String(row.card_number)
    ),
    escapeCsv(row.scanned_at),
    escapeCsv(formatIstDateTime(row.scanned_at)),
    escapeCsv(row.user_agent),
    escapeCsv(row.referrer),
  ]);

  const csvContent = [
    csvHeaders.map(escapeCsv).join(","),
    ...csvRows.map((cols) => cols.join(",")),
  ].join("\r\n");

  return {
    data: csvContent,
    contentType: "text/csv; charset=utf-8",
    filename: `tapme-scan-events-${timestampStr}.csv`,
  };
}
