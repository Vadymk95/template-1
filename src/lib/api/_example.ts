/**
 * 🌱 TEMPLATE SEED — do NOT delete during refactors.
 *
 * Why it exists:
 *   Canonical reference for the REST transport layer pattern — typed `apiClient`
 *   wrapping `fetch` with auth + JSON. `.cursor/brain/MAP.md` points here by name.
 *
 * What it demonstrates:
 *   - response typing via generic argument
 *   - endpoint grouping under a module-level object
 *   - pairing with `_example.queries.ts` for the full transport → cache flow
 *
 * When to delete:
 *   Only when this repo becomes a real MVP AND at least one real `<domain>.ts`
 *   transport module exists. Update `.cursor/brain/TEMPLATE_SEEDS.md` in the
 *   same commit.
 *
 * Leading underscore signals "reference, not wired into app code".
 */
import { apiClient } from './client';

export interface ExampleData {
    id: string;
    message: string;
}

export const exampleApi = {
    getData: () => apiClient<ExampleData>('/example')
};
