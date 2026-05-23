/**
 * Boundary validation — Zod safeFetch wrapper.
 *
 * Validates ALL API responses at the HTTP boundary using Zod schemas. Catches
 * backend shape drift at receive time instead of buried in render ("undefined
 * → NaN → blank UI" class of bug). `z.infer<typeof Schema>` gives a single
 * source of truth for the response type.
 *
 * When to use:
 *   - TanStack Query `queryFn` → `safeFetchQueryFn(url, schema)`
 *   - Direct fetch calls         → `safeFetch(url, schema)`
 *   - storage reads              → `Schema.safeParse(JSON.parse(raw))`
 *
 * When NOT to use:
 *   - tRPC / GraphQL with codegen (separate pattern owns type safety)
 *   - throwaway prototypes
 *   - high-frequency polling where ~50–200μs parse cost matters
 *
 * Pairs with `src/lib/devGuards.ts` `installDevGuards()`: `safeFetchQueryFn`
 * re-throws `AbortError` unchanged so TanStack Query treats it as cancellation
 * (not error), and the dev guard suppresses the leaked unhandledrejection.
 *
 * See `.cursor/brain/DECISIONS.md` ADR "[2026-05] Boundary validation via Zod
 * safeFetch wrapper" for the rationale + revisit trigger.
 */
import type { QueryFunction } from '@tanstack/react-query';
import type { z } from 'zod';

/**
 * Thrown when an HTTP response parses as JSON but does NOT match the expected
 * Zod schema. Exposes the offending `url` and the raw `z.core.$ZodIssue[]` so
 * callers can log / surface diagnostics without re-parsing the error.
 */
export class SchemaValidationError extends Error {
    readonly url: string;
    readonly issues: z.core.$ZodIssue[];

    constructor(url: string, issues: z.core.$ZodIssue[]) {
        super(`Schema validation failed for ${url}: ${issues.length.toString()} issue(s)`);
        this.name = 'SchemaValidationError';
        this.url = url;
        this.issues = issues;
    }
}

/**
 * Fetches `url` and validates the JSON response against `schema`.
 *
 * - Throws `Error` on HTTP non-2xx (`HTTP <status>: <statusText>`).
 * - Throws `SchemaValidationError` if the response body fails `schema.safeParse`.
 * - Forwards `init.signal` to `fetch` so callers can cancel in-flight requests.
 *
 * For TanStack Query usage prefer `safeFetchQueryFn` — it wires the query
 * `signal` and re-throws `AbortError` unchanged.
 */
export const safeFetch = async <T>(
    url: string,
    schema: z.ZodType<T>,
    init?: RequestInit
): Promise<T> => {
    const response = await fetch(url, init);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status.toString()}: ${response.statusText}`);
    }

    const raw: unknown = await response.json();
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
        throw new SchemaValidationError(url, parsed.error.issues);
    }

    return parsed.data;
};

/**
 * Curried factory returning a TanStack Query `queryFn` for `url` validated by
 * `schema`. Forwards the query `signal` to `fetch` and re-throws `AbortError`
 * unchanged so TanStack Query recognises it as cancellation (not error) — see
 * `src/lib/devGuards.ts` for the paired dev-mode AbortError suppression.
 *
 * Usage:
 *
 *   const GreetingSchema = z.object({ greeting: z.string() });
 *
 *   export const greetingOptions = () =>
 *       queryOptions({
 *           queryKey: greetingKeys.detail(),
 *           queryFn: safeFetchQueryFn(`${API_BASE_URL}/greeting`, GreetingSchema),
 *           staleTime: 60_000
 *       });
 */
export const safeFetchQueryFn =
    <T>(url: string, schema: z.ZodType<T>): QueryFunction<T> =>
    ({ signal }) =>
        // `fetch` rejects with `DOMException('AbortError')` on signal abort —
        // re-thrown unchanged so TanStack Query treats it as cancellation.
        safeFetch(url, schema, { signal });
