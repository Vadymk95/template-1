import { http, HttpResponse } from 'msw';

import type { LoginRequest, LoginResponse } from '@/lib/api/auth';

// Default handlers — used in all tests unless overridden.
// To override per-test:
//   server.use(http.post('/api/auth/login', () => HttpResponse.json({ message: 'fail' }, { status: 500 })))
//
// Pattern: http.<method>('**/api/<endpoint>', () => HttpResponse.json(<response>))
// The ** prefix lets the base URL vary between local and CI environments.

export const handlers = [
    http.get('**/api/greeting', () => HttpResponse.json({ greeting: 'Hello from MSW' })),

    http.post('**/api/auth/login', async ({ request }) => {
        const body = (await request.json()) as LoginRequest;
        // Simulate valid credentials: test@example.com / password123
        if (body.email === 'test@example.com' && body.password === 'password123') {
            return HttpResponse.json<LoginResponse>({
                username: 'Test User',
                token: 'mock-jwt-token'
            });
        }
        return HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 });
    }),

    http.post('**/api/auth/logout', () => new HttpResponse(null, { status: 204 }))
];
