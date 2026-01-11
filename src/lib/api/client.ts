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

// Backend API URL (configure via .env file or use default)
// Note: Frontend runs on port 3000, backend typically runs on different port (e.g., 3001, 8000, etc.)
// Examples: 'http://localhost:3001/api' (local backend), 'https://api.yourapp.com' (production)
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export interface ApiError {
    message: string;
    status: number;
}

export const apiClient = async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            // Add auth token if available
            // Authorization: `Bearer ${token}`,
            ...options?.headers
        }
    });

    if (!response.ok) {
        // Try to read detailed error message from JSON response
        let errorMessage = response.statusText || 'Unknown error';

        try {
            const errorData = await response.json();
            // Support common error response formats: { message }, { error }, { error: { message } }
            errorMessage =
                errorData?.message || errorData?.error?.message || errorData?.error || errorMessage;
        } catch {
            // If JSON parsing fails, fallback to statusText
            errorMessage = response.statusText || `HTTP ${response.status}`;
        }

        const error: ApiError = {
            message: errorMessage,
            status: response.status
        };
        throw error;
    }

    return response.json();
};
