import type { RouteObject } from 'react-router-dom';

import { App } from '@/App';
import { RouteErrorBoundary } from '@/components/common/RouteErrorBoundary';
import { RouteSkeleton } from '@/components/common/RouteSkeleton';
import { ProtectedRoute } from '@/hocs/ProtectedRoute';
import { WithSuspense } from '@/hocs/WithSuspense';
import { DashboardPage } from '@/pages/DashboardPage';
import { DevPlayground } from '@/pages/DevPlayground';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RoutesPath } from '@/router/routes';

const baseRoutes: RouteObject[] = [
    {
        path: RoutesPath.Root,
        element: <App />,
        errorElement: <RouteErrorBoundary />,
        children: [
            {
                index: true,
                element: <HomePage />
            },
            {
                path: RoutesPath.Login,
                element: (
                    <WithSuspense fallback={<RouteSkeleton />}>
                        <LoginPage />
                    </WithSuspense>
                )
            },
            // Protected routes — redirects to /login when not authenticated
            {
                element: <ProtectedRoute />,
                children: [
                    {
                        path: RoutesPath.Dashboard,
                        element: (
                            <WithSuspense fallback={<RouteSkeleton />}>
                                <DashboardPage />
                            </WithSuspense>
                        )
                    }
                ]
            },
            {
                path: RoutesPath.NotFound,
                element: (
                    <WithSuspense fallback={<RouteSkeleton />}>
                        <NotFoundPage />
                    </WithSuspense>
                )
            },
            // DEV-only: shadcn primitive showcase at /dev/ui.
            // Tree-shaken out of production bundles — zero ship cost.
            // See `src/pages/DevPlayground/DevPlayground.tsx` header for the
            // template-seed contract, and `.cursor/brain/TEMPLATE_SEEDS.md`.
            ...(import.meta.env.DEV
                ? [
                      {
                          path: RoutesPath.DevPlayground,
                          element: (
                              <WithSuspense fallback={<RouteSkeleton />}>
                                  <DevPlayground />
                              </WithSuspense>
                          )
                      }
                  ]
                : [])
        ]
    }
];

export default baseRoutes;
