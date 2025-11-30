import { type ReactNode, Suspense } from 'react';

interface WithSuspenseOptions {
    showLoader?: boolean;
}

export const WithSuspense = (
    element: ReactNode,
    options: WithSuspenseOptions = { showLoader: true }
) => <Suspense fallback={options.showLoader ? <div>Loading...</div> : null}>{element}</Suspense>;
