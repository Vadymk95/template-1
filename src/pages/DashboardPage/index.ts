import { lazy } from 'react';

export const DashboardPage = lazy(() =>
    import('./DashboardPage').then((module) => ({ default: module.DashboardPage }))
);
