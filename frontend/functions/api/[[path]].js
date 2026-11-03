import { handleProxy } from '../_proxy.js';

/**
 * Cloudflare Pages Function catch-all for /api and /api/*
 * Routes incoming admin and public API requests to the backend Worker via Service Binding.
 *
 * @param {import('@cloudflare/workers-types').EventContext<any, any, any>} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  return handleProxy(context);
}
