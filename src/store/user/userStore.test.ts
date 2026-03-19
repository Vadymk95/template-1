import { beforeEach, describe, expect, it } from 'vitest';

import { useUserStore } from './userStore';

describe('userStore', () => {
    beforeEach(() => {
        useUserStore.getState().logout();
    });

    it('initializes with default values', () => {
        const { isLoggedIn, username } = useUserStore.getState();
        expect(isLoggedIn).toBe(false);
        expect(username).toBeNull();
    });

    it('sets user when setUser is called', () => {
        useUserStore.getState().setUser('john.doe');
        const { isLoggedIn, username } = useUserStore.getState();
        expect(isLoggedIn).toBe(true);
        expect(username).toBe('john.doe');
    });

    it('clears user when logout is called', () => {
        useUserStore.getState().setUser('john.doe');
        useUserStore.getState().logout();
        const { isLoggedIn, username } = useUserStore.getState();
        expect(isLoggedIn).toBe(false);
        expect(username).toBeNull();
    });

    it('has auto-selectors utility available', () => {
        expect(useUserStore.use).toBeDefined();
        expect(typeof useUserStore.use.isLoggedIn).toBe('function');
        expect(typeof useUserStore.use.username).toBe('function');
        expect(typeof useUserStore.use.setUser).toBe('function');
        expect(typeof useUserStore.use.logout).toBe('function');
    });
});
