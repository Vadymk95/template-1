/**
 * Example API module
 *
 * NOTE: This is an example file. Replace or remove based on your needs.
 * - Delete this file if using Supabase/Firebase SDK
 * - Replace with your actual API modules (users.ts, products.ts, etc.)
 */

import { apiClient } from './client';

export interface ExampleData {
    id: string;
    message: string;
}

/**
 * Example API function - replace with your actual endpoints
 */
export const exampleApi = {
    getData: () => apiClient<ExampleData>('/example')
};
