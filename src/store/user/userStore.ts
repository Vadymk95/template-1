import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { createSelectors } from '../utils/createSelectors';

interface UserState {
    isLoggedIn: boolean;
    username: string | null;
    token: string | null;
    setUser: (username: string, token: string) => void;
    logout: () => void;
}

const useUserStoreBase = create<UserState>()(
    /**
     * devtools wires the store to Redux DevTools.
     * action.type follows user-store/<slice>/<action> to keep event history searchable.
     * persist saves isLoggedIn + token to localStorage so the session survives page refresh.
     */
    devtools(
        persist(
            (set) => ({
                isLoggedIn: false,
                username: null,
                token: null,
                setUser: (username: string, token: string) => {
                    set({ isLoggedIn: true, username, token }, false, {
                        type: 'user-store/user/setUser'
                    });
                },
                logout: () => {
                    set({ isLoggedIn: false, username: null, token: null }, false, {
                        type: 'user-store/user/logout'
                    });
                }
            }),
            { name: 'user-store' }
        ),
        { name: 'user-store' }
    )
);

export const useUserStore = createSelectors(useUserStoreBase);

// Read-only accessor for apiClient — avoids circular imports (store does not import apiClient)
export const getAuthToken = (): string | null => useUserStoreBase.getState().token;
