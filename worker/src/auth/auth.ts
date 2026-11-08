
import type { AppEnv } from "../types";
import { verifyPassword } from "./password";
import { createSession } from "./session";

export interface AdminAccount {
  id: string;
  username: string;
  password_hash: string;
  role: "main_admin" | "staff";
  status: "active" | "disabled";
  deleted_at?: string | null;
}

export type LoginResult =
  | {
      success: true;
      admin: {
        id: string;
        username: string;
        role: "main_admin" | "staff";
      };
      token: string;
      expiresAt: string;
    }
  | {
      success: false;
      message: string;
    };

export async function loginAdmin(
  env: AppEnv,
  username: string,
  password: string,
): Promise<LoginResult> {
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 100 ||
    password.length > 1024 ||
    !username.trim() ||
    !password
  ) {
    return {
      success: false,
      message: "Invalid username or password.",
    };
  }

  const admin = await env.DB.prepare(
    `SELECT id, username, password_hash, role, status, deleted_at
     FROM admins
     WHERE username = ? COLLATE NOCASE
     LIMIT 1`,
  )
    .bind(username.trim())
    .first<AdminAccount>();

  if (!admin || admin.status !== "active" || admin.deleted_at !== null) {
    return {
      success: false,
      message: "Invalid username or password.",
    };
  }

  const passwordValid = await verifyPassword(
    password,
    admin.password_hash,
    env.PASSWORD_PEPPER,
  );

  if (!passwordValid) {
    return {
      success: false,
      message: "Invalid username or password.",
    };
  }

  const session = await createSession(env, admin.id);

  await env.DB.prepare(
    "UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(admin.id)
    .run();

  return {
    success: true,
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
    },
    token: session.token,
    expiresAt: session.expiresAt,
  };
}
