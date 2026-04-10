import { beforeEach, describe, expect, it } from 'vitest';

import { useUserStore } from './userStore';

describe('userStore', () => {
    beforeEach(() => {
        useUserStore.getState().logout();
    });

    it('initializes with default values', () => {
        const { isLoggedIn, username, token } = useUserStore.getState();
        expect(isLoggedIn).toBe(false);
        expect(username).toBeNull();
        expect(token).toBeNull();
    });

    it('sets user and token when setUser is called', () => {
        useUserStore.getState().setUser('john.doe', 'jwt-abc');
        const { isLoggedIn, username, token } = useUserStore.getState();
        expect(isLoggedIn).toBe(true);
        expect(username).toBe('john.doe');
        expect(token).toBe('jwt-abc');
    });

    it('clears user and token when logout is called', () => {
        useUserStore.getState().setUser('john.doe', 'jwt-abc');
        useUserStore.getState().logout();
        const { isLoggedIn, username, token } = useUserStore.getState();
        expect(isLoggedIn).toBe(false);
        expect(username).toBeNull();
        expect(token).toBeNull();
    });

    it('has auto-selectors utility available', () => {
        expect(useUserStore.use).toBeDefined();
        expect(typeof useUserStore.use.isLoggedIn).toBe('function');
        expect(typeof useUserStore.use.username).toBe('function');
        expect(typeof useUserStore.use.token).toBe('function');
        expect(typeof useUserStore.use.setUser).toBe('function');
        expect(typeof useUserStore.use.logout).toBe('function');
    });
});
