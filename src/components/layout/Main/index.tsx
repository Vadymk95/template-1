import type { FunctionComponent, Ref } from 'react';
import { Outlet } from 'react-router-dom';

interface MainProps {
    ref?: Ref<HTMLElement>;
}

export const Main: FunctionComponent<MainProps> = ({ ref }) => {
    return (
        <main
            ref={ref}
            id="main"
            tabIndex={-1}
            className="container mx-auto flex h-full flex-1 items-center justify-center py-12"
        >
            <Outlet />
        </main>
    );
};
