/**
 * Base API Client
 *
 * NOTE: This API client structure is optional.
 * - If you're using Supabase/Firebase SDK or other BaaS solutions,
 *   you can remove this folder and use their SDKs directly with TanStack Query.
 * - If you're building a custom REST API, this structure provides a good starting point.
 *
 * Replace this file or extend it based on your backend needs.
 */

import { env } from '@/env';
import { getAuthToken } from '@/store/user/userStore';

// Backend API URL — configure VITE_API_URL in .env (validated by src/env.ts via t3-env + zod)
const API_BASE_URL = env.VITE_API_URL ?? 'http://localhost:3001/api';

// Proper Error subclass so instanceof checks and only-throw-error rule work correctly
export class ApiError extends Error {
    // Declared separately: parameter properties are forbidden with erasableSyntaxOnly
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

const extractErrorMessage = (data: unknown): string | null => {
    if (data === null || typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    if (obj.error !== null && typeof obj.error === 'object') {
        const nested = obj.error as Record<string, unknown>;
        if (typeof nested.message === 'string') return nested.message;
    }
    return null;
};

export const apiClient = async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            // Cast: HeadersInit can be string[][] but our callers pass Record<string, string>
            ...(options?.headers as Record<string, string> | undefined)
        }
    });

    if (!response.ok) {
        let errorMessage = response.statusText || 'Unknown error';

        try {
            const errorData: unknown = await response.json();
            errorMessage =
                (extractErrorMessage(errorData) ?? response.statusText) ||
                `HTTP ${String(response.status)}`;
        } catch {
            errorMessage = response.statusText || `HTTP ${String(response.status)}`;
        }

        throw new ApiError(response.status, errorMessage);
    }

    return response.json() as Promise<T>;
};
