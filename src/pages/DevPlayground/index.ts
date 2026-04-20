import { lazy } from 'react';

export const DevPlayground = lazy(() =>
    import('./DevPlayground').then((module) => ({ default: module.DevPlayground }))
);
