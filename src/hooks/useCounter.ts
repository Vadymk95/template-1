import { useAppStore } from '@/store';

type CounterSelectors = {
    count: number;
    increase: () => void;
    decrease: () => void;
    resetCount: () => void;
};

export const useCounter = (): CounterSelectors => {
    /**
     * Auto-generated selectors from createSelectors are thin hooks.
     * Call them directly (e.g. useAppStore.use.count()) to subscribe safely
     * and avoid invalid hook call errors.
     */
    const count = useAppStore.use.count();
    const increase = useAppStore.use.increase();
    const decrease = useAppStore.use.decrease();
    const resetCount = useAppStore.use.resetCount();

    return {
        count,
        increase,
        decrease,
        resetCount
    };
};
