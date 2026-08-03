import { lazy } from 'react';

export const DevPlayground = lazy(() =>
    import('./DevPlayground').then((module) => ({ default: module.DevPlayground }))
);

export const ContentStress = lazy(() =>
    import('./ContentStress').then((module) => ({ default: module.ContentStress }))
);
