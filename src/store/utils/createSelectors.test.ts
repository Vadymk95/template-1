import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { create } from 'zustand';

import { createSelectors } from './createSelectors';

interface CounterState {
    count: number;
    increment: () => void;
}

const buildStore = () =>
    createSelectors(
        create<CounterState>()((set) => ({
            count: 0,
            increment: () => {
                set((state) => ({ count: state.count + 1 }));
            }
        }))
    );

describe('createSelectors', () => {
    it('exposes a per-key selector hook for every state field', () => {
        const store = buildStore();

        expect(Object.keys(store.use).sort()).toEqual(['count', 'increment']);
    });

    it('selector hooks read live state and re-render on change', () => {
        const store = buildStore();
        const { result } = renderHook(() => store.use.count());

        expect(result.current).toBe(0);

        act(() => {
            store.getState().increment();
        });

        expect(result.current).toBe(1);
    });
});
