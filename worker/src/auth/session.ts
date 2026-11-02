
import type { AppEnv } from "../types";

const SESSION_DURATION_SECONDS = 60 * 60 * 24; // 24 hours

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSession(
  env: AppEnv,
  adminId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = generateToken();
  const tokenHash = await hashToken(token);

  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_SECONDS * 1000,
  ).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, admin_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), adminId, tokenHash, expiresAt)
    .run();

  return { token, expiresAt };
}

export async function getSession(
  env: AppEnv,
  token: string,
): Promise<{ id: string; username: string; role: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }

  const tokenHash = await hashToken(token);

  const session = await env.DB.prepare(
    `SELECT admins.id, admins.username, admins.role
     FROM sessions
     INNER JOIN admins ON admins.id = sessions.admin_id
     WHERE sessions.token_hash = ?
       AND sessions.expires_at > ?
       AND admins.status = 'active'`,
  )
    .bind(tokenHash, new Date().toISOString())
    .first<{ id: string; username: string; role: string }>();

  return session ?? null;
}

export async function deleteSession(
  env: AppEnv,
  token: string,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return;
  }

  const tokenHash = await hashToken(token);

  await env.DB.prepare(
    "DELETE FROM sessions WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .run();
}

function getCookieName(env: AppEnv): string {
  const name = env.COOKIE_NAME;

  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error("Invalid session cookie name.");
  }

  if (name.startsWith("__Host-") && env.COOKIE_SAME_SITE !== "None") {
    // __Host- cookies require Secure and Path=/.
    // SameSite can be Lax, Strict, or None.
  }

  return name;
}

function getCookieAttributes(env: AppEnv): string {
  const sameSite = env.COOKIE_SAME_SITE;

  if (!["Lax", "Strict", "None"].includes(sameSite)) {
    throw new Error("Invalid SameSite cookie configuration.");
  }

  return `HttpOnly; Secure; SameSite=${sameSite}; Path=/`;
}

export function createSessionCookie(
  env: AppEnv,
  token: string,
  maxAge = SESSION_DURATION_SECONDS,
): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("Invalid session token.");
  }

  const cookieName = getCookieName(env);
  const attributes = getCookieAttributes(env);

  return `${cookieName}=${token}; ${attributes}; Max-Age=${maxAge}`;
}

export function clearSessionCookie(env: AppEnv): string {
  const cookieName = getCookieName(env);
  const attributes = getCookieAttributes(env);

  return `${cookieName}=; ${attributes}; Max-Age=0`;
}
