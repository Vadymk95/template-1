// Replaces the cross-fetch polyfill (pulled by i18next-http-backend)
// All baseline-widely-available browsers support native fetch — no polyfill needed.
// This alias saves ~9.5kb (~2.8kb brotli) from the production bundle.
export const fetch = globalThis.fetch;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export default globalThis.fetch;
