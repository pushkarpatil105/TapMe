import type { AppEnv } from "../types";

export interface AuditLogItem {
  id: string;
  admin_id: string;
  admin_username: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: unknown;
  created_at: string;
}

export interface AuditLogQueryParams {
  page?: string | number | null;
  limit?: string | number | null;
  action?: string | null;
  entity_type?: string | null;
  admin_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  search?: string | null;
}

export type AuditServiceResult =
  | {
      success: true;
      data: {
        logs: AuditLogItem[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          total_pages: number;
        };
      };
    }
  | {
      success: false;
      error: string;
      status: number;
    };

interface RawAuditLogRow {
  id: string;
  admin_id: string;
  admin_username: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string;
  created_at: string;
}

export interface ParsedDateFilter {
  normalized: string;
  isDateOnly: boolean;
  isExclusive: boolean;
}

/**
 * Validates and normalizes user-provided date strings into standard UTC "YYYY-MM-DD HH:MM:SS".
 *
 * Supports:
 * - Date-only strings "YYYY-MM-DD":
 *     - start_date expands to inclusive day start: "YYYY-MM-DD 00:00:00" (operator: >=)
 *     - end_date expands to exclusive next-day boundary: "YYYY-MM-DD 00:00:00" of following day (operator: <)
 * - Full ISO timestamps "YYYY-MM-DDTHH:MM:SSZ":
 *     - converted to equivalent UTC "YYYY-MM-DD HH:MM:SS" (inclusive operator: <=)
 */
export function parseAndNormalizeDate(
  input: string,
  isEnd: boolean,
): ParsedDateFilter | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1. Check for YYYY-MM-DD date-only format
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);

    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    const d = new Date(Date.UTC(year, month - 1, day));
    if (
      d.getUTCFullYear() !== year ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day
    ) {
      return null;
    }

    const pad = (n: number) => String(n).padStart(2, "0");

    if (isEnd) {
      // Exclusive upper boundary: midnight UTC on the following day
      const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
      const nextYear = nextDay.getUTCFullYear();
      const nextMonth = pad(nextDay.getUTCMonth() + 1);
      const nextDate = pad(nextDay.getUTCDate());
      const nextDatePart = `${nextYear}-${nextMonth}-${nextDate}`;

      return {
        normalized: `${nextDatePart} 00:00:00`,
        isDateOnly: true,
        isExclusive: true,
      };
    }

    // Inclusive lower boundary: midnight UTC on the specified day
    const datePart = `${year}-${pad(month)}-${pad(day)}`;
    return {
      normalized: `${datePart} 00:00:00`,
      isDateOnly: true,
      isExclusive: false,
    };
  }

  // 2. Full ISO timestamp
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) {
    return null;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  const ms = d.getUTCMilliseconds();
  const msStr = ms > 0 ? `.${String(ms).padStart(3, "0")}` : "";

  return {
    normalized: `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}${msStr}`,
    isDateOnly: false,
    isExclusive: false,
  };
}

/**
 * Queries paginated audit logs with parameterized filtering.
 * Strictly read-only; joins admins table to retrieve actor username.
 * Preserves audit history even if the actor account was disabled or soft-removed.
 */
export async function listAuditLogs(
  env: AppEnv,
  queryParams: AuditLogQueryParams = {},
): Promise<AuditServiceResult> {
  const {
    page = 1,
    limit = 20,
    action,
    entity_type,
    admin_id,
    start_date,
    end_date,
    search,
  } = queryParams;

  // 1. Validate page
  let safePage = 1;
  if (page !== undefined && page !== null && page !== "") {
    const pageStr = String(page).trim();
    if (!/^\d+$/.test(pageStr)) {
      return {
        success: false,
        error: "page must be a positive integer greater than or equal to 1.",
        status: 400,
      };
    }
    safePage = Number(pageStr);
    if (safePage < 1) {
      return {
        success: false,
        error: "page must be a positive integer greater than or equal to 1.",
        status: 400,
      };
    }
  }

  // 2. Validate limit
  let safeLimit = 20;
  if (limit !== undefined && limit !== null && limit !== "") {
    const limitStr = String(limit).trim();
    if (!/^\d+$/.test(limitStr)) {
      return {
        success: false,
        error: "limit must be a positive integer between 1 and 100.",
        status: 400,
      };
    }
    safeLimit = Number(limitStr);
    if (safeLimit < 1 || safeLimit > 100) {
      return {
        success: false,
        error: "limit must be a positive integer between 1 and 100.",
        status: 400,
      };
    }
  }

  // 3. Validate action filter
  let validatedAction: string | null = null;
  if (action !== undefined && action !== null && action !== "") {
    if (typeof action !== "string" || action.trim().length > 100) {
      return {
        success: false,
        error: "action must be a valid string up to 100 characters.",
        status: 400,
      };
    }
    validatedAction = action.trim();
  }

  // 4. Validate entity_type filter
  let validatedEntityType: string | null = null;
  if (entity_type !== undefined && entity_type !== null && entity_type !== "") {
    if (typeof entity_type !== "string" || entity_type.trim().length > 50) {
      return {
        success: false,
        error: "entity_type must be a valid string up to 50 characters.",
        status: 400,
      };
    }
    validatedEntityType = entity_type.trim();
  }

  // 5. Validate admin_id filter
  let validatedAdminId: string | null = null;
  if (admin_id !== undefined && admin_id !== null && admin_id !== "") {
    if (typeof admin_id !== "string" || admin_id.trim().length > 100) {
      return {
        success: false,
        error: "admin_id must be a valid string up to 100 characters.",
        status: 400,
      };
    }
    validatedAdminId = admin_id.trim();
  }

  // 6. Validate date filters
  let normalizedStart: ParsedDateFilter | null = null;
  if (start_date !== undefined && start_date !== null && start_date !== "") {
    if (typeof start_date !== "string") {
      return {
        success: false,
        error: "Invalid start_date format.",
        status: 400,
      };
    }
    normalizedStart = parseAndNormalizeDate(start_date, false);
    if (!normalizedStart) {
      return {
        success: false,
        error: "Invalid start_date format. Use YYYY-MM-DD or full ISO timestamp.",
        status: 400,
      };
    }
  }

  let normalizedEnd: ParsedDateFilter | null = null;
  if (end_date !== undefined && end_date !== null && end_date !== "") {
    if (typeof end_date !== "string") {
      return {
        success: false,
        error: "Invalid end_date format.",
        status: 400,
      };
    }
    normalizedEnd = parseAndNormalizeDate(end_date, true);
    if (!normalizedEnd) {
      return {
        success: false,
        error: "Invalid end_date format. Use YYYY-MM-DD or full ISO timestamp.",
        status: 400,
      };
    }
  }

  if (normalizedStart && normalizedEnd) {
    const isInvalid = normalizedEnd.isExclusive
      ? normalizedStart.normalized >= normalizedEnd.normalized
      : normalizedStart.normalized > normalizedEnd.normalized;

    if (isInvalid) {
      return {
        success: false,
        error: "start_date must be earlier than or equal to end_date.",
        status: 400,
      };
    }
  }

  // 7. Validate search filter
  let validatedSearch: string | null = null;
  if (search !== undefined && search !== null && search !== "") {
    if (typeof search !== "string" || search.trim().length > 100) {
      return {
        success: false,
        error: "search must be a valid string up to 100 characters.",
        status: 400,
      };
    }
    validatedSearch = search.trim();
  }

  // 8. Construct parameterized query
  const whereConditions: string[] = [];
  const queryBindings: (string | number)[] = [];

  if (validatedAction) {
    whereConditions.push("audit_logs.action = ?");
    queryBindings.push(validatedAction);
  }

  if (validatedEntityType) {
    whereConditions.push("audit_logs.entity_type = ?");
    queryBindings.push(validatedEntityType);
  }

  if (validatedAdminId) {
    whereConditions.push("audit_logs.admin_id = ?");
    queryBindings.push(validatedAdminId);
  }

  if (normalizedStart) {
    whereConditions.push("audit_logs.created_at >= ?");
    queryBindings.push(normalizedStart.normalized);
  }

  if (normalizedEnd) {
    const op = normalizedEnd.isExclusive ? "<" : "<=";
    whereConditions.push(`audit_logs.created_at ${op} ?`);
    queryBindings.push(normalizedEnd.normalized);
  }

  if (validatedSearch) {
    const isNum = /^\d+$/.test(validatedSearch);

    if (isNum) {
      const parsedNum = Number(validatedSearch);
      whereConditions.push(
        "(audit_logs.entity_id = ? OR audit_logs.entity_id = ? OR json_extract(audit_logs.details, '$.card_number') = ? OR admins.username = ?)"
      );
      queryBindings.push(validatedSearch, String(parsedNum), parsedNum, validatedSearch);
    } else {
      const escapedLike = validatedSearch.replace(/[%_\\]/g, "\\$&");
      const likePattern = `%${escapedLike}%`;
      whereConditions.push(
        "(audit_logs.entity_id = ? OR admins.username LIKE ? ESCAPE '\\' OR audit_logs.details LIKE ? ESCAPE '\\')"
      );
      queryBindings.push(validatedSearch, likePattern, likePattern);
    }
  }

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  // 9. Count total matching rows
  const countSql = `
    SELECT count(*) as total
    FROM audit_logs
    LEFT JOIN admins ON audit_logs.admin_id = admins.id
    ${whereClause}
  `;
  const countStmt = env.DB.prepare(countSql).bind(...queryBindings);
  const countRes = await countStmt.first<{ total: number }>();
  const total = countRes?.total ?? 0;

  // 10. Fetch paginated records with LEFT JOIN
  const offset = (safePage - 1) * safeLimit;
  const selectSql = `
    SELECT
      audit_logs.id,
      audit_logs.admin_id,
      admins.username AS admin_username,
      audit_logs.action,
      audit_logs.entity_type,
      audit_logs.entity_id,
      audit_logs.details,
      audit_logs.created_at
    FROM audit_logs
    LEFT JOIN admins ON audit_logs.admin_id = admins.id
    ${whereClause}
    ORDER BY audit_logs.created_at DESC, audit_logs.rowid DESC
    LIMIT ? OFFSET ?
  `;

  const rowsStmt = env.DB.prepare(selectSql).bind(
    ...queryBindings,
    safeLimit,
    offset,
  );
  const rowsRes = await rowsStmt.all<RawAuditLogRow>();

  const logs: AuditLogItem[] = (rowsRes.results || []).map((row) => {
    let parsedDetails: unknown = null;
    try {
      parsedDetails = JSON.parse(row.details);
    } catch {
      parsedDetails = row.details;
    }

    return {
      id: row.id,
      admin_id: row.admin_id,
      admin_username: row.admin_username,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      details: parsedDetails,
      created_at: row.created_at,
    };
  });

  const totalPages = Math.ceil(total / safeLimit) || 1;

  return {
    success: true,
    data: {
      logs,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        total_pages: totalPages,
      },
    },
  };
}

