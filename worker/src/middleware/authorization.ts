
import type { AppEnv } from "../types";
import {
  getSession,
  clearSessionCookie,
} from "../auth/session";

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  role: "main_admin" | "staff";
}

export type AuthResult =
  | {
      authenticated: true;
      admin: AuthenticatedAdmin;
    }
  | {
      authenticated: false;
      response: Response;
    };

function getCookie(
  request: Request,
  name: string,
): string | null {
  const cookieHeader = request.headers.get("Cookie");

  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");

    if (separator === -1) continue;

    const key = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();

    if (key === name) return value;
  }

  return null;
}

export async function requireAuth(
  request: Request,
  env: AppEnv,
): Promise<AuthResult> {
  const token = getCookie(request, env.COOKIE_NAME);

  if (!token) {
    return {
      authenticated: false,
      response: Response.json(
        { error: "Authentication required." },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      ),
    };
  }

  const session = await getSession(env, token);

  if (!session) {
    return {
      authenticated: false,
      response: Response.json(
        { error: "Invalid or expired session." },
        {
          status: 401,
          headers: {
            "Set-Cookie": clearSessionCookie(env),
            "Cache-Control": "no-store",
          },
        },
      ),
    };
  }

  if (
    session.role !== "main_admin" &&
    session.role !== "staff"
  ) {
    return {
      authenticated: false,
      response: Response.json(
        { error: "Invalid account role." },
        {
          status: 403,
          headers: {
            "Set-Cookie": clearSessionCookie(env),
            "Cache-Control": "no-store",
          },
        },
      ),
    };
  }

  return {
    authenticated: true,
    admin: {
      id: session.id,
      username: session.username,
      role: session.role,
    },
  };
}

export function requireMainAdmin(
  admin: AuthenticatedAdmin,
): Response | null {
  if (admin.role !== "main_admin") {
    return Response.json(
      { error: "Main Admin permission required." },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return null;
}
