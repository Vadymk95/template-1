import type { FunctionComponent, ReactNode } from 'react';
import { Suspense } from 'react';

export interface WithSuspenseProps {
    children: ReactNode;
    /** Required — pass RouteSkeleton (or a page-specific skeleton) for lazy route boundaries. */
    fallback: ReactNode;
}

export const WithSuspense: FunctionComponent<WithSuspenseProps> = ({ children, fallback }) => (
    <Suspense fallback={fallback}>{children}</Suspense>
);
