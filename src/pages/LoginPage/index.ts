import { lazy } from 'react';

export const LoginPage = lazy(() =>
    import('./LoginPage').then((module) => ({ default: module.LoginPage }))
);
