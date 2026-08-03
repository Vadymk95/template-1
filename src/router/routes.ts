export const RoutesPath = {
    Root: '/',
    Login: '/login',
    Dashboard: '/dashboard',
    DevPlayground: '/dev/ui',
    DevContentStress: '/dev/ui/content-stress',
    NotFound: '*'
} as const;

export type RoutePath = (typeof RoutesPath)[keyof typeof RoutesPath];
