import type { AppEnv } from "../types";

const ALLOWED_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

const ALLOWED_HEADERS = new Set([
  "content-type",
  "accept",
]);

export function getAllowedOrigins(env: AppEnv): Set<string> {
  if (!env || typeof env.ADMIN_ORIGINS !== "string") {
    return new Set();
  }

  return new Set(
    env.ADMIN_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => {
        // Reject wildcards completely
        if (origin === "*" || origin.includes("*")) {
          return "";
        }

        try {
          const url = new URL(origin);

          // Only allow explicit HTTP(S) origins without paths,
          // credentials, query strings, or fragments.
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.origin !== origin.replace(/\/+$/, "") ||
            url.username ||
            url.password
          ) {
            return "";
          }

          return url.origin;
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
}

export function corsHeaders(
  request: Request,
  env: AppEnv,
): Headers {
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  });

  const origin = request.headers.get("Origin");

  if (origin) {
    try {
      const normalizedOrigin = new URL(origin).origin;

      if (getAllowedOrigins(env).has(normalizedOrigin)) {
        headers.set("Access-Control-Allow-Origin", normalizedOrigin);
      }
    } catch {
      // Invalid origins receive no permission.
    }
  }

  return headers;
}

export function handlePreflight(
  request: Request,
  env: AppEnv,
): Response {
  const origin = request.headers.get("Origin");
  const requestedMethod = request.headers.get(
    "Access-Control-Request-Method",
  );
  const requestedHeaders = request.headers.get(
    "Access-Control-Request-Headers",
  );

  const headers = corsHeaders(request, env);

  if (
    !origin ||
    !headers.has("Access-Control-Allow-Origin") ||
    !requestedMethod ||
    !ALLOWED_METHODS.has(requestedMethod.toUpperCase())
  ) {
    return new Response(null, {
      status: 403,
      headers,
    });
  }

  if (requestedHeaders) {
    const requested = requestedHeaders
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);

    const allHeadersAllowed = requested.every((header) =>
      ALLOWED_HEADERS.has(header),
    );

    if (!allHeadersAllowed) {
      return new Response(null, {
        status: 403,
        headers,
      });
    }
  }

  return new Response(null, {
    status: 204,
    headers,
  });
}
