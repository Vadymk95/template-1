import type { StoreApi, UseBoundStore } from 'zustand';

type StoreState<S> = S extends { getState: () => infer T } ? T : never;

type WithSelectors<S extends UseBoundStore<StoreApi<object>>> = S & {
    use: {
        [K in keyof StoreState<S>]: () => StoreState<S>[K];
    };
};

export const createSelectors = <S extends UseBoundStore<StoreApi<object>>>(store: S) => {
    const storeWithSelectors = store as WithSelectors<S>;
    storeWithSelectors.use = {} as WithSelectors<S>['use'];

    const keys = Object.keys(store.getState()) as Array<keyof StoreState<S>>;

    for (const key of keys) {
        storeWithSelectors.use[key] = () => store((state) => (state as StoreState<S>)[key]);
    }

    return storeWithSelectors;
};
