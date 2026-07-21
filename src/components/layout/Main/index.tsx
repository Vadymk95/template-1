import { forwardRef } from 'react';
import { Outlet } from 'react-router-dom';

export const Main = forwardRef<HTMLElement>(function Main(_props, ref) {
    return (
        <main
            ref={ref}
            id="main"
            tabIndex={-1}
            className="container mx-auto flex min-h-0 w-full flex-1 items-center justify-center py-12"
        >
            <Outlet />
        </main>
    );
});
