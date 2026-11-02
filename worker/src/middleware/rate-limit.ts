
import type { AppEnv } from "../types";

async function hashKey(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function checkLoginRateLimit(
  request: Request,
  env: AppEnv,
  username: string,
): Promise<boolean> {
  const ipAddress =
    request.headers.get("CF-Connecting-IP") || "unknown-ip";

  const normalizedUsername = username.trim().toLowerCase();

  const accountKey = await hashKey(
    `${ipAddress}:${normalizedUsername}`,
  );

  const [ipResult, accountResult] = await Promise.all([
    env.AUTH_IP_LIMITER.limit({
      key: `login-ip:${ipAddress}`,
    }),
    env.AUTH_ACCOUNT_LIMITER.limit({
      key: `login-account:${accountKey}`,
    }),
  ]);

  return ipResult.success && accountResult.success;
}
