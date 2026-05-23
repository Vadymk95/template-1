import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { DEVTOOLS_NAMES, STORAGE_KEYS, USER_STORE_ACTIONS } from '@/store/keys';
import { createSelectors } from '@/store/utils/createSelectors';

interface UserState {
    isLoggedIn: boolean;
    username: string | null;
    token: string | null;
    setUser: (username: string, token: string) => void;
    logout: () => void;
}

// devtools ships Redux DevTools bridge code even with `enabled: false`.
// Gate the whole middleware behind import.meta.env.DEV so the tree-shaker drops it in prod,
// keeping the auth token out of the DevTools extension surface for end users.
// The `as typeof devtools` cast preserves the enhanced `set(state, replace, action)` signature
// used below; the extra action arg is silently ignored by the underlying setter in prod.
const withDevtools = (import.meta.env.DEV ? devtools : <T>(fn: T): T => fn) as typeof devtools;

const useUserStoreBase = create<UserState>()(
    withDevtools(
        persist(
            (set) => ({
                isLoggedIn: false,
                username: null,
                token: null,
                setUser: (username: string, token: string) => {
                    set({ isLoggedIn: true, username, token }, false, {
                        type: USER_STORE_ACTIONS.SET_USER
                    });
                },
                logout: () => {
                    set({ isLoggedIn: false, username: null, token: null }, false, {
                        type: USER_STORE_ACTIONS.LOGOUT
                    });
                }
            }),
            { name: STORAGE_KEYS.USER_STORE }
        ),
        { name: DEVTOOLS_NAMES.USER_STORE }
    )
);

export const useUserStore = createSelectors(useUserStoreBase);

// Read-only accessor for apiClient — avoids circular imports (store does not import apiClient)
export const getAuthToken = (): string | null => useUserStoreBase.getState().token;
