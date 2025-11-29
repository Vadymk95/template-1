import type { RouteObject } from 'react-router-dom';

import { App } from '@/App';
import { WithSuspense } from '@/hocs/WithSuspense';
import { DevPlayground } from '@/pages/DevPlayground';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';

import { RoutesPath } from '../routes';

const baseRoutes: RouteObject[] = [
    {
        path: RoutesPath.Root,
        element: <App />,
        children: [
            {
                // index: true means that this route is the default route
                index: true,
                element: <HomePage />
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
