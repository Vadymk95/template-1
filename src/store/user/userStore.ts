import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { createSelectors } from '../utils/createSelectors';

interface UserState {
    isLoggedIn: boolean;
    username: string | null;
    setUser: (username: string) => void;
    logout: () => void;
}

const useUserStoreBase = create<UserState>()(
    /**
     * devtools wires the store to Redux DevTools.
     * action.type follows user-store/<slice>/<action> to keep event history searchable.
     */
    devtools(
        (set) => ({
            isLoggedIn: false,
            username: null,
            setUser: (username: string) => {
                set({ isLoggedIn: true, username }, false, { type: 'user-store/user/setUser' });
            },
            logout: () => {
                set({ isLoggedIn: false, username: null }, false, {
                    type: 'user-store/user/logout'
                });
            }
        }),
        { name: 'user-store' }
    )
);

export const useUserStore = createSelectors(useUserStoreBase);
