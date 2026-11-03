import type { AppEnv, CreateCardInput, UpdateCardInput } from "./types";
import { checkCsrf } from "./middleware/csrf";
import { corsHeaders, handlePreflight } from "./middleware/cors";
import { successResponse, errorResponse } from "./utils/responses";
import { loginAdmin } from "./auth/auth";
import {
	createSessionCookie,
	clearSessionCookie,
	deleteSession,
} from "./auth/session";
import {
	requireAuth,
	requireMainAdmin,
	getCookie,
} from "./middleware/authorization";
import { checkLoginRateLimit } from "./middleware/rate-limit";
import {
	createCard,
	listCards,
	getCardByIdOrToken,
	updateCard,
	changeCardStatus,
	type CardLifecycleAction,
} from "./cards/cards";
import {
	handlePublicRedirect,
	handlePublicCardApi,
} from "./public/public";

function withCors(
	response: Response,
	request: Request,
	env: AppEnv,
): Response {
	const headers = corsHeaders(request, env);

	response.headers.forEach((value, key) => {
		headers.set(key, value);
	});

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export default {
	async fetch(
		request: Request,
		env: AppEnv,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// 1. Handle browser CORS preflight requests.
		if (request.method === "OPTIONS") {
			return handlePreflight(request, env);
		}

		// 2. Public route classification (strictly separate from protected admin APIs)
		const isPublicRedirectRoute = url.pathname === "/r" || url.pathname.startsWith("/r/");
		const isPublicApiRoute = url.pathname.startsWith("/api/public/");
		const isHealthRoute = url.pathname === "/api/health";

		// 2a. Public redirect route: GET /r/:public_token
		if (isPublicRedirectRoute) {
			if (request.method !== "GET" && request.method !== "HEAD") {
				return new Response("Method Not Allowed", { status: 405 });
			}
			return handlePublicRedirect(request, env, url);
		}

		// 2b. Public customer API route: GET /api/public/cards/:public_token
		if (isPublicApiRoute) {
			if (request.method !== "GET" && request.method !== "HEAD") {
				return withCors(
					errorResponse("Method not allowed.", 405),
					request,
					env,
				);
			}
			if (url.pathname.startsWith("/api/public/cards/")) {
				return withCors(
					await handlePublicCardApi(request, env, url),
					request,
					env,
				);
			}
			return withCors(
				errorResponse("Route not found.", 404),
				request,
				env,
			);
		}

		// 2c. Public health check: GET /api/health
		if (isHealthRoute && request.method === "GET") {
			return withCors(
				successResponse({
					status: "ok",
					service: "TapMe API",
					timestamp: new Date().toISOString(),
				}),
				request,
				env,
			);
		}

		// 3. Protected Admin routes: Reject untrusted origins on state-changing requests
		const csrfError = checkCsrf(request, env);

		if (csrfError) {
			return withCors(csrfError, request, env);
		}

		// 3. POST /api/auth/login
		if (url.pathname === "/api/auth/login" && request.method === "POST") {
			let body: { username?: unknown; password?: unknown };

			try {
				body = await request.json();
			} catch {
				return withCors(
					errorResponse("Invalid request body.", 400),
					request,
					env,
				);
			}

			const { username, password } = body;

			if (
				typeof username !== "string" ||
				typeof password !== "string" ||
				!username.trim() ||
				!password
			) {
				return withCors(
					errorResponse(
						"Username and password are required.",
						400,
					),
					request,
					env,
				);
			}

			const withinLimit = await checkLoginRateLimit(
				request,
				env,
				username,
			);

			if (!withinLimit) {
				return withCors(
					errorResponse(
						"Too many login attempts. Try again later.",
						429,
					),
					request,
					env,
				);
			}

			const result = await loginAdmin(env, username, password);

			if (!result.success) {
				return withCors(
					errorResponse(result.message, 401),
					request,
					env,
				);
			}

			const cookie = createSessionCookie(env, result.token);
			const response = successResponse({
				id: result.admin.id,
				username: result.admin.username,
				role: result.admin.role,
			});

			response.headers.set("Set-Cookie", cookie);

			return withCors(response, request, env);
		}

		// 4. POST /api/auth/logout
		if (
			url.pathname === "/api/auth/logout" &&
			request.method === "POST"
		) {
			const token = getCookie(request, env.COOKIE_NAME);

			if (token) {
				await deleteSession(env, token);
			}

			const response = successResponse({ message: "Logged out." });

			response.headers.set("Set-Cookie", clearSessionCookie(env));

			return withCors(response, request, env);
		}

		// 5. GET /api/auth/me
		if (url.pathname === "/api/auth/me" && request.method === "GET") {
			const auth = await requireAuth(request, env);

			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			return withCors(
				successResponse({
					id: auth.admin.id,
					username: auth.admin.username,
					role: auth.admin.role,
				}),
				request,
				env,
			);
		}

		// 6. POST /api/cards
		if (url.pathname === "/api/cards" && request.method === "POST") {
			const auth = await requireAuth(request, env);

			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			let body: Record<string, unknown>;
			try {
				body = await request.json();
			} catch {
				return withCors(
					errorResponse("Invalid request body.", 400),
					request,
					env,
				);
			}

			if (!body || typeof body !== "object") {
				return withCors(
					errorResponse("Invalid request body.", 400),
					request,
					env,
				);
			}

			const result = await createCard(
				env,
				auth.admin.id,
				body as unknown as CreateCardInput,
				body,
			);

			if (!result.success) {
				return withCors(
					errorResponse(result.error, result.status),
					request,
					env,
				);
			}

			return withCors(
				successResponse(result.card, 201),
				request,
				env,
			);
		}

		// 7. GET /api/cards
		if (url.pathname === "/api/cards" && request.method === "GET") {
			const auth = await requireAuth(request, env);

			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const page =
				parseInt(url.searchParams.get("page") || "1", 10) || 1;
			const limit =
				parseInt(url.searchParams.get("limit") || "20", 10) || 20;
			const statusParam = url.searchParams.get("status");

			if (
				statusParam &&
				!["active", "inactive", "archived"].includes(statusParam)
			) {
				return withCors(
					errorResponse(
						"Invalid status filter. Allowed values: active, inactive, archived.",
						400,
					),
					request,
					env,
				);
			}

			if (
				statusParam === "archived" &&
				auth.admin.role !== "main_admin"
			) {
				return withCors(
					errorResponse(
						"Staff members are not permitted to view archived cards.",
						403,
					),
					request,
					env,
				);
			}

			const data = await listCards(env, page, limit, statusParam);

			return withCors(successResponse(data), request, env);
		}

		// 8. Lifecycle actions: POST /api/cards/:id/(activate|deactivate|archive|restore)
		const lifecycleMatch = url.pathname.match(
			/^\/api\/cards\/([^/]+)\/(activate|deactivate|archive|restore)$/,
		);
		if (lifecycleMatch && request.method === "POST") {
			const id = lifecycleMatch[1];
			const action = lifecycleMatch[2] as CardLifecycleAction;

			const auth = await requireAuth(request, env);

			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);

			if (mainAdminError) {
				return withCors(mainAdminError, request, env);
			}

			const result = await changeCardStatus(
				env,
				id,
				auth.admin.id,
				action,
			);

			if (!result.success) {
				return withCors(
					errorResponse(result.error, result.status),
					request,
					env,
				);
			}

			return withCors(successResponse(result.card), request, env);
		}

		// 9. GET /api/cards/:id
		if (
			url.pathname.startsWith("/api/cards/") &&
			request.method === "GET"
		) {
			const id = url.pathname.slice("/api/cards/".length);

			if (!id || id.includes("/")) {
				return withCors(
					errorResponse("Route not found.", 404),
					request,
					env,
				);
			}

			const auth = await requireAuth(request, env);

			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const card = await getCardByIdOrToken(env, id);

			if (!card) {
				return withCors(
					errorResponse("Card not found.", 404),
					request,
					env,
				);
			}

			if (
				card.status === "archived" &&
				auth.admin.role !== "main_admin"
			) {
				return withCors(
					errorResponse(
						"Staff members are not permitted to view archived cards.",
						403,
					),
					request,
					env,
				);
			}

			return withCors(successResponse(card), request, env);
		}

		// 10. PATCH /api/cards/:id
		if (
			url.pathname.startsWith("/api/cards/") &&
			request.method === "PATCH"
		) {
			const id = url.pathname.slice("/api/cards/".length);

			if (!id || id.includes("/")) {
				return withCors(
					errorResponse("Route not found.", 404),
					request,
					env,
				);
			}

			const auth = await requireAuth(request, env);

			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);

			if (mainAdminError) {
				return withCors(mainAdminError, request, env);
			}

			let body: Record<string, unknown>;
			try {
				body = await request.json();
			} catch {
				return withCors(
					errorResponse("Invalid request body.", 400),
					request,
					env,
				);
			}

			if (!body || typeof body !== "object") {
				return withCors(
					errorResponse("Invalid request body.", 400),
					request,
					env,
				);
			}

			const result = await updateCard(
				env,
				id,
				auth.admin.id,
				body as unknown as UpdateCardInput,
				body,
			);

			if (!result.success) {
				return withCors(
					errorResponse(result.error, result.status),
					request,
					env,
				);
			}

			return withCors(successResponse(result.card), request, env);
		}

		// 11. Health check.
		if (url.pathname === "/api/health" && request.method === "GET") {
			return withCors(
				successResponse({
					status: "ok",
					service: "TapMe API",
					timestamp: new Date().toISOString(),
				}),
				request,
				env,
			);
		}

		// 12. Unknown routes.
		return withCors(
			errorResponse("Route not found.", 404),
			request,
			env,
		);
	},
} satisfies ExportedHandler<AppEnv>;
