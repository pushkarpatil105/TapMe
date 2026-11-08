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
	isValidPublicToken,
} from "./public/public";
import { listStaff, createStaff, changeStaffStatus, type StaffLifecycleAction } from "./staff/staff";
import { listAuditLogs } from "./audit/audit";
import { telemetry } from "./diagnostics/telemetry";
import { getSystemHealth } from "./diagnostics/diagnostics";
import {
	getStorageOverview,
	previewAuditCleanup,
	executeAuditCleanup,
	previewScanCleanup,
	executeScanCleanup,
	exportAuditLogsData,
	exportScanEventsData,
} from "./storage/storage";

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
			telemetry.recordApiMetric("csrf_rejected", { path: url.pathname });
			return withCors(csrfError, request, env);
		}
		telemetry.recordApiMetric("request");

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
				telemetry.recordAuthMetric("rate_limited", { usernamePrefix: username.slice(0, 3) });
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
				telemetry.recordAuthMetric("failed_login", { usernamePrefix: username.slice(0, 3) });
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

		// 8b. GET /api/cards/lookup-by-token/:public_token
		if (
			url.pathname.startsWith("/api/cards/lookup-by-token/") &&
			request.method === "GET"
		) {
			const token = url.pathname.slice(
				"/api/cards/lookup-by-token/".length,
			);

			if (!token || token.includes("/")) {
				return withCors(
					errorResponse("Invalid public token format.", 400),
					request,
					env,
				);
			}

			const auth = await requireAuth(request, env);

			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			if (!isValidPublicToken(token)) {
				return withCors(
					errorResponse("Invalid public token format.", 400),
					request,
					env,
				);
			}

			const card = await getCardByIdOrToken(env, token);

			if (!card) {
				return withCors(
					errorResponse("Card not found.", 404),
					request,
					env,
				);
			}

			return withCors(
				successResponse({
					card_number: card.card_number,
					formatted_card_number: card.formatted_card_number,
					public_token: card.public_token,
					business_name: card.business_name,
					location: card.location,
					status: card.status,
					qr_type: card.qr_type,
					configured_at: card.configured_at,
					is_configured: card.is_configured,
					total_scans: card.total_scans,
					created_at: card.created_at,
					updated_at: card.updated_at,
					links: card.links || [],
				}),
				request,
				env,
			);
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
				auth.admin.role,
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

		// 11. GET /api/staff (List staff accounts - main_admin only)
		if (url.pathname === "/api/staff" && request.method === "GET") {
			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				return withCors(mainAdminError, request, env);
			}

			const staffList = await listStaff(env);
			return withCors(successResponse(staffList), request, env);
		}

		// 12. POST /api/staff (Create staff account - main_admin only)
		if (url.pathname === "/api/staff" && request.method === "POST") {
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

			const result = await createStaff(env, auth.admin.id, body);
			if (!result.success) {
				return withCors(
					errorResponse(result.error, result.status),
					request,
					env,
				);
			}

			return withCors(successResponse(result.data, 201), request, env);
		}

		// 13. Staff lifecycle: POST /api/staff/:id/(activate|deactivate|remove) - main_admin only
		const staffLifecycleMatch = url.pathname.match(
			/^\/api\/staff\/([^/]+)\/(activate|deactivate|remove)$/,
		);
		if (staffLifecycleMatch && request.method === "POST") {
			const staffId = staffLifecycleMatch[1];
			const action = staffLifecycleMatch[2] as StaffLifecycleAction;

			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				return withCors(mainAdminError, request, env);
			}

			const result = await changeStaffStatus(
				env,
				auth.admin.id,
				staffId,
				action,
			);

			if (!result.success) {
				return withCors(
					errorResponse(result.error, result.status),
					request,
					env,
				);
			}

			return withCors(successResponse(result.data), request, env);
		}

		// 14. GET /api/audit-logs (Query audit logs - main_admin only)
		if (url.pathname === "/api/audit-logs" && request.method === "GET") {
			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				return withCors(mainAdminError, request, env);
			}

			const queryParams = {
				page: url.searchParams.get("page"),
				limit: url.searchParams.get("limit"),
				action: url.searchParams.get("action"),
				entity_type: url.searchParams.get("entity_type"),
				admin_id: url.searchParams.get("admin_id"),
				start_date: url.searchParams.get("start_date"),
				end_date: url.searchParams.get("end_date"),
				search: url.searchParams.get("search"),
			};

			const result = await listAuditLogs(env, queryParams);
			if (!result.success) {
				return withCors(
					errorResponse(result.error, result.status),
					request,
					env,
				);
			}

			return withCors(successResponse(result.data), request, env);
		}

		// 15. System Health & Diagnostics (Phase 7: Main Admin only)
		if (url.pathname === "/api/system/health" && request.method === "GET") {
			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				telemetry.recordApiMetric("forbidden", { path: url.pathname });
				return withCors(mainAdminError, request, env);
			}

			const health = await getSystemHealth(env);
			return withCors(successResponse(health), request, env);
		}

		// 16. Database Storage Management Overview (Phase 7: Main Admin only)
		if (url.pathname === "/api/system/storage" && request.method === "GET") {
			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				telemetry.recordApiMetric("forbidden", { path: url.pathname });
				return withCors(mainAdminError, request, env);
			}

			const storage = await getStorageOverview(env);
			return withCors(successResponse(storage), request, env);
		}

		// 17. Audit Logs Export (CSV & JSON, Phase 7: Main Admin only)
		if (url.pathname === "/api/system/export/audit-logs" && request.method === "GET") {
			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				telemetry.recordApiMetric("forbidden", { path: url.pathname });
				return withCors(mainAdminError, request, env);
			}

			const rawFormat = (url.searchParams.get("format") || "json").toLowerCase();
			const format = rawFormat === "csv" ? "csv" : "json";
			const cutoff = url.searchParams.get("cutoff") || undefined;
			const startDate = url.searchParams.get("startDate") || undefined;
			const endDate = url.searchParams.get("endDate") || undefined;
			const action = url.searchParams.get("action") || undefined;

			const result = await exportAuditLogsData(env, {
				format,
				cutoff,
				startDate,
				endDate,
				action,
			});

			const headers = corsHeaders(request, env);
			headers.set("Content-Type", result.contentType);
			headers.set(
				"Content-Disposition",
				`attachment; filename="${result.filename}"`
			);

			return new Response(result.data, {
				status: 200,
				headers,
			});
		}

		// 18. Scan Events Export (CSV & JSON, Phase 7: Main Admin only)
		if (url.pathname === "/api/system/export/scans" && request.method === "GET") {
			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				telemetry.recordApiMetric("forbidden", { path: url.pathname });
				return withCors(mainAdminError, request, env);
			}

			const rawFormat = (url.searchParams.get("format") || "csv").toLowerCase();
			const format = rawFormat === "json" ? "json" : "csv";
			const cutoff = url.searchParams.get("cutoff") || undefined;
			const startDate = url.searchParams.get("startDate") || undefined;
			const endDate = url.searchParams.get("endDate") || undefined;

			const result = await exportScanEventsData(env, {
				format,
				cutoff,
				startDate,
				endDate,
			});

			const headers = corsHeaders(request, env);
			headers.set("Content-Type", result.contentType);
			headers.set(
				"Content-Disposition",
				`attachment; filename="${result.filename}"`
			);

			return new Response(result.data, {
				status: 200,
				headers,
			});
		}

		// 19. Audit Logs Cleanup Preview (Phase 7: Main Admin only)
		if (url.pathname === "/api/system/cleanup/audit/preview" && request.method === "GET") {
			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				telemetry.recordApiMetric("forbidden", { path: url.pathname });
				return withCors(mainAdminError, request, env);
			}

			const cutoff = url.searchParams.get("cutoff");
			if (!cutoff) {
				return withCors(
					errorResponse("Missing required 'cutoff' parameter.", 400),
					request,
					env
				);
			}

			try {
				const preview = await previewAuditCleanup(env, cutoff);
				return withCors(successResponse(preview), request, env);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : "Invalid cutoff format";
				return withCors(errorResponse(msg, 400), request, env);
			}
		}

		// 20. Audit Logs Cleanup Execution (Phase 7: Main Admin only)
		if (url.pathname === "/api/system/cleanup/audit" && request.method === "POST") {
			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				telemetry.recordApiMetric("forbidden", { path: url.pathname });
				return withCors(mainAdminError, request, env);
			}

			let body: { cutoff?: unknown; confirmed?: unknown; export_confirmed?: unknown };
			try {
				body = await request.json();
			} catch {
				return withCors(
					errorResponse("Invalid JSON payload.", 400),
					request,
					env
				);
			}

			if (typeof body.cutoff !== "string" || !body.cutoff) {
				return withCors(
					errorResponse("A valid 'cutoff' ISO date string is required.", 400),
					request,
					env
				);
			}

			if (body.confirmed !== true) {
				return withCors(
					errorResponse("Deletion requires explicit confirmation (confirmed: true).", 400),
					request,
					env
				);
			}

			try {
				const result = await executeAuditCleanup(env, auth.admin, body.cutoff);
				return withCors(successResponse(result), request, env);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : "Audit cleanup failed";
				const status = msg.includes("in progress") ? 409 : 500;
				return withCors(errorResponse(msg, status), request, env);
			}
		}

		// 21. Scan Events Cleanup Preview (Phase 7: Main Admin only)
		if (url.pathname === "/api/system/cleanup/scans/preview" && request.method === "GET") {
			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				telemetry.recordApiMetric("forbidden", { path: url.pathname });
				return withCors(mainAdminError, request, env);
			}

			const cutoff = url.searchParams.get("cutoff");
			if (!cutoff) {
				return withCors(
					errorResponse("Missing required 'cutoff' parameter.", 400),
					request,
					env
				);
			}

			try {
				const preview = await previewScanCleanup(env, cutoff);
				return withCors(successResponse(preview), request, env);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : "Invalid cutoff format";
				return withCors(errorResponse(msg, 400), request, env);
			}
		}

		// 22. Scan Events Cleanup Execution (Phase 7: Main Admin only)
		if (url.pathname === "/api/system/cleanup/scans" && request.method === "POST") {
			const auth = await requireAuth(request, env);
			if (!auth.authenticated) {
				return withCors(auth.response, request, env);
			}

			const mainAdminError = requireMainAdmin(auth.admin);
			if (mainAdminError) {
				telemetry.recordApiMetric("forbidden", { path: url.pathname });
				return withCors(mainAdminError, request, env);
			}

			let body: { cutoff?: unknown; confirmed?: unknown };
			try {
				body = await request.json();
			} catch {
				return withCors(
					errorResponse("Invalid JSON payload.", 400),
					request,
					env
				);
			}

			if (typeof body.cutoff !== "string" || !body.cutoff) {
				return withCors(
					errorResponse("A valid 'cutoff' ISO date string is required.", 400),
					request,
					env
				);
			}

			if (body.confirmed !== true) {
				return withCors(
					errorResponse("Deletion requires explicit confirmation (confirmed: true).", 400),
					request,
					env
				);
			}

			try {
				const result = await executeScanCleanup(env, auth.admin, body.cutoff);
				return withCors(successResponse(result), request, env);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : "Scan cleanup failed";
				const status = msg.includes("in progress") ? 409 : 500;
				return withCors(errorResponse(msg, status), request, env);
			}
		}

		// 23. Health check.
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
