import type { AppEnv } from "../types";

const STATE_CHANGING_METHODS = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

function getAllowedOrigins(env: AppEnv): Set<string> {
  return new Set(
    env.ADMIN_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => {
        try {
          return new URL(origin).origin;
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
}

export function isTrustedOrigin(
  request: Request,
  env: AppEnv,
): boolean {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return false;
  }

  try {
    const normalizedOrigin = new URL(origin).origin;
    return getAllowedOrigins(env).has(normalizedOrigin);
  } catch {
    return false;
  }
}

export function checkCsrf(
  request: Request,
  env: AppEnv,
): Response | null {
  if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
    return null;
  }

  if (!isTrustedOrigin(request, env)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Forbidden: untrusted origin.",
      }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return null;
}