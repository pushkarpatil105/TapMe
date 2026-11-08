import type { AppEnv } from "../types";
import { hashPassword } from "../auth/password";

export interface StaffAccount {
  id: string;
  username: string;
  role: "main_admin" | "staff";
  status: "active" | "disabled";
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
  deleted_at: string | null;
}

export type StaffLifecycleAction = "activate" | "deactivate" | "remove";

export interface CreateStaffInput {
  username?: unknown;
  password?: unknown;
}

export type StaffServiceResult<T> =
  | { success: true; data: T; status?: number }
  | { success: false; error: string; status: number };

const USERNAME_REGEX = /^[a-zA-Z0-9_.@-]{3,50}$/;

/**
 * Lists all staff members in reverse chronological order.
 * Never returns password hashes.
 */
export async function listStaff(env: AppEnv): Promise<StaffAccount[]> {
  const result = await env.DB.prepare(
    `SELECT id, username, role, status, created_at, created_by, last_login_at, deleted_at
     FROM admins
     WHERE role = 'staff'
     ORDER BY created_at DESC`
  ).all<StaffAccount>();

  return result.results || [];
}

/**
 * Creates a new staff account with active status.
 * Hashes password using PBKDF2-SHA256 and the production pepper binding.
 * Records 'staff.created' in audit logs atomically with the user insertion.
 */
export async function createStaff(
  env: AppEnv,
  actingAdminId: string,
  input: CreateStaffInput,
): Promise<StaffServiceResult<StaffAccount>> {
  const { username, password } = input;

  // 1. Validate username
  if (
    typeof username !== "string" ||
    !username.trim() ||
    !USERNAME_REGEX.test(username.trim())
  ) {
    return {
      success: false,
      error: "Username must be 3-50 characters containing only letters, numbers, '.', '_', '-', or '@'.",
      status: 400,
    };
  }

  const cleanUsername = username.trim();

  // 2. Validate password
  if (typeof password !== "string" || password.length < 12) {
    return {
      success: false,
      error: "Password must be at least 12 characters.",
      status: 400,
    };
  }

  if (new TextEncoder().encode(password).length > 1024) {
    return {
      success: false,
      error: "Password is too long.",
      status: 400,
    };
  }

  // 3. Reject duplicate usernames (case-insensitive)
  const existing = await env.DB.prepare(
    `SELECT id FROM admins WHERE username = ? COLLATE NOCASE LIMIT 1`
  )
    .bind(cleanUsername)
    .first<{ id: string }>();

  if (existing) {
    return {
      success: false,
      error: "An account with this username already exists.",
      status: 409,
    };
  }

  // 4. Hash password with production pepper
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password, env.PASSWORD_PEPPER);
  } catch (err: unknown) {
    console.error("Failed to hash password:", err);
    return {
      success: false,
      error: "Internal security error during password hashing.",
      status: 500,
    };
  }

  const newStaffId = crypto.randomUUID();
  const auditLogId = crypto.randomUUID();

  // 5. Construct audit event details (never log password or password hash)
  const auditDetails = JSON.stringify({
    staff_id: newStaffId,
    username: cleanUsername,
    role: "staff",
    status: "active",
  });

  const insertAdminStmt = env.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, role, status, created_by, created_at)
     VALUES (?, ?, ?, 'staff', 'active', ?, CURRENT_TIMESTAMP)`
  ).bind(newStaffId, cleanUsername, passwordHash, actingAdminId);

  const insertAuditStmt = env.DB.prepare(
    `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, 'staff.created', 'staff', ?, ?, CURRENT_TIMESTAMP)`
  ).bind(auditLogId, actingAdminId, newStaffId, auditDetails);

  try {
    await env.DB.batch([insertAdminStmt, insertAuditStmt]);
  } catch (err: unknown) {
    console.error("Failed to create staff account atomically:", err);
    return {
      success: false,
      error: "Database error while creating staff account.",
      status: 500,
    };
  }

  // 6. Fetch and return clean created record
  const createdRecord = await env.DB.prepare(
    `SELECT id, username, role, status, created_at, created_by, last_login_at, deleted_at
     FROM admins
     WHERE id = ?`
  )
    .bind(newStaffId)
    .first<StaffAccount>();

  if (!createdRecord) {
    return {
      success: false,
      error: "Failed to load created staff account.",
      status: 500,
    };
  }

  return {
    success: true,
    data: createdRecord,
    status: 201,
  };
}

/**
 * Changes a staff member's status (activate, deactivate, remove).
 *
 * Rules:
 * - Only main_admin can invoke.
 * - Prevents self-deactivation and self-removal.
 * - Prevents disabling/removing the last active main_admin.
 * - Deactivating or removing revokes all active sessions for the account.
 * - Activating a removed account is strictly rejected.
 * - Removal is soft deletion (status = 'disabled', deleted_at = CURRENT_TIMESTAMP).
 * - Never physically deletes records.
 * - Records audit events atomically in D1 batch.
 */
export async function changeStaffStatus(
  env: AppEnv,
  actingAdminId: string,
  staffId: string,
  action: StaffLifecycleAction,
): Promise<StaffServiceResult<StaffAccount>> {
  // 1. Validate action
  if (!["activate", "deactivate", "remove"].includes(action)) {
    return {
      success: false,
      error: "Invalid staff lifecycle action. Allowed: activate, deactivate, remove.",
      status: 400,
    };
  }

  // 2. Prevent self-deactivation / self-removal
  if (staffId === actingAdminId) {
    return {
      success: false,
      error: "Self-deactivation and self-removal are not permitted.",
      status: 400,
    };
  }

  // 3. Retrieve target account
  const target = await env.DB.prepare(
    `SELECT id, username, role, status, created_at, created_by, last_login_at, deleted_at
     FROM admins
     WHERE id = ?`
  )
    .bind(staffId)
    .first<StaffAccount>();

  if (!target) {
    return {
      success: false,
      error: "Account not found.",
      status: 404,
    };
  }

  // 4. Guard against disabling or removing the last active main_admin
  if (target.role === "main_admin" && (action === "deactivate" || action === "remove")) {
    const activeMainAdmins = await env.DB.prepare(
      `SELECT count(*) as count
       FROM admins
       WHERE role = 'main_admin' AND status = 'active' AND (deleted_at IS NULL)`
    ).first<{ count: number }>();

    if ((activeMainAdmins?.count ?? 0) <= 1) {
      return {
        success: false,
        error: "Cannot disable or remove the last active main administrator.",
        status: 400,
      };
    }
  }

  // 5. Account state rules
  if (target.deleted_at !== null) {
    return {
      success: false,
      error: "Cannot modify or activate a removed account.",
      status: 400,
    };
  }

  let newStatus: "active" | "disabled";
  let shouldSetDeletedAt = false;
  let auditAction: "staff.activated" | "staff.deactivated" | "staff.removed";

  switch (action) {
    case "activate":
      if (target.status === "active") {
        return {
          success: false,
          error: "Staff account is already active.",
          status: 400,
        };
      }
      newStatus = "active";
      auditAction = "staff.activated";
      break;

    case "deactivate":
      if (target.status === "disabled") {
        return {
          success: false,
          error: "Staff account is already deactivated.",
          status: 400,
        };
      }
      newStatus = "disabled";
      auditAction = "staff.deactivated";
      break;

    case "remove":
      newStatus = "disabled";
      shouldSetDeletedAt = true;
      auditAction = "staff.removed";
      break;

    default:
      return {
        success: false,
        error: "Invalid staff lifecycle action.",
        status: 400,
      };
  }

  // 6. Build atomic D1 batch statements
  const batchStatements: D1PreparedStatement[] = [];

  if (shouldSetDeletedAt) {
    batchStatements.push(
      env.DB.prepare(
        `UPDATE admins
         SET status = 'disabled',
             deleted_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(staffId)
    );
  } else {
    batchStatements.push(
      env.DB.prepare(
        `UPDATE admins
         SET status = ?
         WHERE id = ?`
      ).bind(newStatus, staffId)
    );
  }

  // 7. Revoke all active sessions when deactivated or removed
  if (action === "deactivate" || action === "remove") {
    batchStatements.push(
      env.DB.prepare("DELETE FROM sessions WHERE admin_id = ?").bind(staffId)
    );
  }

  // 8. Record audit log atomically
  const auditLogId = crypto.randomUUID();
  const auditDetails = JSON.stringify({
    staff_id: staffId,
    username: target.username,
    role: target.role,
    previous_status: target.status,
    new_status: newStatus,
    action,
    deleted: shouldSetDeletedAt,
  });

  batchStatements.push(
    env.DB.prepare(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, 'staff', ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      auditLogId,
      actingAdminId,
      auditAction,
      staffId,
      auditDetails
    )
  );

  try {
    await env.DB.batch(batchStatements);
  } catch (err: unknown) {
    console.error("Failed to update staff status atomically:", err);
    return {
      success: false,
      error: "Database error while updating staff account status.",
      status: 500,
    };
  }

  // 9. Fetch updated record
  const updatedRecord = await env.DB.prepare(
    `SELECT id, username, role, status, created_at, created_by, last_login_at, deleted_at
     FROM admins
     WHERE id = ?`
  )
    .bind(staffId)
    .first<StaffAccount>();

  if (!updatedRecord) {
    return {
      success: false,
      error: "Failed to reload updated staff account.",
      status: 500,
    };
  }

  return {
    success: true,
    data: updatedRecord,
  };
}

