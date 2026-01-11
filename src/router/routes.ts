export const RoutesPath = {
    Root: '/',
    DevPlayground: '/dev/ui',
    NotFound: '*'
} as const;

export type RoutePath = (typeof RoutesPath)[keyof typeof RoutesPath];
