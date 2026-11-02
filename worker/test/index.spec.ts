
import {
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("TapMe Worker", () => {
	it("returns health information (unit style)", async () => {
		const request = new IncomingRequest(
			"http://localhost:8787/api/health",
		);

		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);

		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);

		const body = await response.json() as {
			success: boolean;
			data: {
				status: string;
				service: string;
				timestamp: string;
			};
		};

		expect(body.success).toBe(true);
		expect(body.data.status).toBe("ok");
		expect(body.data.service).toBe("TapMe API");
		expect(body.data.timestamp).toBeTruthy();
	});

	it("returns health information (integration style)", async () => {
		const response = await SELF.fetch(
			"http://localhost/api/health",
		);

		expect(response.status).toBe(200);

		const body = await response.json() as {
			success: boolean;
			data: {
				status: string;
				service: string;
			};
		};

		expect(body.success).toBe(true);
		expect(body.data.status).toBe("ok");
		expect(body.data.service).toBe("TapMe API");
	});

	it("returns 404 for unknown routes", async () => {
		const request = new IncomingRequest(
			"http://localhost:8787/api/unknown",
		);

		const response = await worker.fetch(
			request,
			env,
			createExecutionContext(),
		);

		expect(response.status).toBe(404);
	});

	it("rejects state-changing requests without an origin", async () => {
		const request = new IncomingRequest(
			"http://localhost:8787/api/test",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: "{}",
			},
		);

		const response = await worker.fetch(
			request,
			env,
			createExecutionContext(),
		);

		expect(response.status).toBe(403);
	});
});
