export const RoutesPath = {
    Root: '/',
    Login: '/login',
    Dashboard: '/dashboard',
    DevPlayground: '/dev/ui',
    NotFound: '*'
} as const;

export type RoutePath = (typeof RoutesPath)[keyof typeof RoutesPath];
