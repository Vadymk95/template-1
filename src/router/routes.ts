export const RoutesPath = {
    Root: '/',
    Login: '/login',
    Dashboard: '/dashboard',
    NotFound: '*'
} as const;

export type RoutePath = (typeof RoutesPath)[keyof typeof RoutesPath];
