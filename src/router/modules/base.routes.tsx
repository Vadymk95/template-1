import type { RouteObject } from 'react-router-dom';

import { App } from '@/App';
import { ProtectedRoute } from '@/hocs/ProtectedRoute';
import { WithSuspense } from '@/hocs/WithSuspense';
import { DashboardPage } from '@/pages/DashboardPage';
import { DevPlayground } from '@/pages/DevPlayground';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

import { RoutesPath } from '../routes';

const baseRoutes: RouteObject[] = [
    {
        path: RoutesPath.Root,
        element: <App />,
        children: [
            {
                index: true,
                element: <HomePage />
            },
            {
                path: RoutesPath.Login,
                element: WithSuspense(<LoginPage />)
            },
            // Protected routes — redirects to /login when not authenticated
            {
                element: <ProtectedRoute />,
                children: [
                    {
                        path: RoutesPath.Dashboard,
                        element: WithSuspense(<DashboardPage />)
                    }
                ]
            },
            {
                path: RoutesPath.NotFound,
                element: WithSuspense(<NotFoundPage />)
            },
            ...(import.meta.env.DEV
                ? [
                      {
                          path: RoutesPath.DevPlayground,
                          element: WithSuspense(<DevPlayground />)
                      }
                  ]
                : [])
        ]
    }
];

export default baseRoutes;
