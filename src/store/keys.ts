/**
 * Storage + Zustand devtools constants — central registry for strings that
 * cross module boundaries OR carry external contracts (semver-relevant).
 *
 * Scope (per `.cursor/brain/DECISIONS.md` "[2026-05] Magic strings → constants"):
 *   - `STORAGE_KEYS` — localStorage keys (external contract: renaming breaks
 *     persisted user data). Includes Zustand `persist({ name })` keys AND
 *     plain `localStorage.setItem(key, ...)` keys used by non-store hooks.
 *   - `DEVTOOLS_NAMES` — Zustand `devtools({ name })` labels (Redux DevTools
 *     panel grouping; refactor-safe rename).
 *   - `USER_STORE_ACTIONS` — `set(..., false, { type })` labels for the user
 *     store (refactor + DevTools discoverability). Per-store ACTION constants
 *     keep the namespace short and avoid one mega-object.
 *
 * Pattern: `as const` objects + `typeof X[keyof typeof X]` types — zero
 * runtime overhead, tree-shakeable, no reverse-mapping bloat (vs `enum`).
 */

export const STORAGE_KEYS = {
    USER_STORE: 'user-store',
    THEME: 'theme'
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const DEVTOOLS_NAMES = {
    USER_STORE: 'user-store'
} as const;

export type DevtoolsName = (typeof DEVTOOLS_NAMES)[keyof typeof DEVTOOLS_NAMES];

export const USER_STORE_ACTIONS = {
    SET_USER: 'user-store/user/setUser',
    LOGOUT: 'user-store/user/logout'
} as const;

export type UserStoreAction = (typeof USER_STORE_ACTIONS)[keyof typeof USER_STORE_ACTIONS];
