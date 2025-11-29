import { createBrowserRouter } from 'react-router-dom';

import baseRoutes from './modules/base.routes';

// Router assembly point:
// Import route modules and combine them into a single router configuration.
// When adding new domains (e.g., admin, billing), create new modules and add them here:
// const router = createBrowserRouter([...baseRoutes, ...adminRoutes, ...billingRoutes]);
export const router = createBrowserRouter([...baseRoutes]);
