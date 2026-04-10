import { apiClient } from './client';

export interface LoginRequest {
    email: string;
    password: string;
}

export interface LoginResponse {
    username: string;
    token: string;
}

export const authApi = {
    login: (data: LoginRequest) =>
        apiClient<LoginResponse>('/auth/login', {
            method: 'POST',
            body: JSON.stringify(data)
        }),

    logout: () => apiClient<undefined>('/auth/logout', { method: 'POST' })
};
