import type { FunctionComponent } from 'react';
import { Outlet } from 'react-router-dom';

export const Main: FunctionComponent = () => {
    return (
        <main className="container mx-auto flex h-full flex-1 items-center justify-center py-12">
            <Outlet />
        </main>
    );
};
