import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { RoutesPath } from '@/router/routes';
import { useUserStore } from '@/store/user/userStore';

/**
 * Wraps routes that require authentication.
 *
 * Usage in router:
 *   { element: <ProtectedRoute />, children: [{ path: '...', element: <Page /> }] }
 *
 * Unauthenticated users are redirected to /login.
 * The `replace` prop prevents the login page from appearing in browser history.
 */
export const ProtectedRoute = (): ReactElement => {
    const isLoggedIn = useUserStore.use.isLoggedIn();
    return isLoggedIn ? <Outlet /> : <Navigate to={RoutesPath.Login} replace />;
};
