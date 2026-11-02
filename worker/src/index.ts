
import type { AppEnv } from "./types";
import { checkCsrf } from "./middleware/csrf";
import { corsHeaders, handlePreflight } from "./middleware/cors";
import { successResponse, errorResponse } from "./utils/responses";

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

		// 2. Reject untrusted origins on state-changing requests.
		const csrfError = checkCsrf(request, env);

		if (csrfError) {
			const headers = corsHeaders(request, env);

			csrfError.headers.forEach((value, key) => {
				headers.set(key, value);
			});

			return new Response(csrfError.body, {
				status: csrfError.status,
				statusText: csrfError.statusText,
				headers,
			});
		}

		// 3. Temporary health-check endpoint.
		if (url.pathname === "/api/health" && request.method === "GET") {
			const response = successResponse({
				status: "ok",
				service: "TapMe API",
				timestamp: new Date().toISOString(),
			});

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

		// 4. Unknown routes.
		const response = errorResponse("Route not found.", 404);
		const headers = corsHeaders(request, env);

		response.headers.forEach((value, key) => {
			headers.set(key, value);
		});

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	},
} satisfies ExportedHandler<AppEnv>;
