import type { D1Migration } from "@cloudflare/vitest-plugin";

declare module "cloudflare:workers" {
  const env: Cloudflare.Env;
  const exports: { default: ExportedHandler<Cloudflare.Env> };
  const SELF: Fetcher;
}

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
