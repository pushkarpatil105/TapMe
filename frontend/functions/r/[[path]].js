import { handleProxy } from '../_proxy.js';

/**
 * Cloudflare Pages Function catch-all for /r and /r/*
 * Routes incoming QR / public card redirect requests to the backend Worker via Service Binding.
 *
 * @param {import('@cloudflare/workers-types').EventContext<any, any, any>} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  return handleProxy(context);
}
