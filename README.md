## Template 1 · React + Vite Starter

A batteries-included starter for building modern React apps with TypeScript. The template ships with state management, data fetching, routing, styling, linting, and testing already wired together so you can focus on features instead of setup. The project targets Node.js **v24** and uses Vite as the build tool.

> **Note:** This is a GitHub template repository. Click "Use this template" on GitHub to create a new repository from this template, or clone it and set your own remote.

### What’s inside

- **React 19** (functional components + hooks) rendered via Vite's React plugin
- **TypeScript** with a shared `@root/*` alias for clean imports
- **React Router v7** for routing and error boundaries at the shell level
- **@tanstack/react-query** pre-configured with a `QueryClientProvider`
- **Zustand** store with selectors and Redux DevTools support
- **React Hook Form** + **Zod** for form validation with type-safe schemas
- **Tailwind CSS** + shadcn/ui primitives + Lucide icons for styling
- **Vitest** + Testing Library with shared render helpers
- **ESLint** (flat config), Prettier, import order rules, lint-staged, and Husky hooks

### Project structure

```
src/
  components/       // UI primitives, layout shell, ErrorBoundary
  hocs/             // Custom HOCs (e.g. WithSuspense)
  hooks/            // Custom hooks (e.g. Zustand selectors)
  pages/            // Route-level components
  router/           // React Router setup and route constants
  store/            // Zustand store with utilities
  test/             // Test setup files and shared helpers
  main.tsx          // App bootstrap (QueryClient + RouterProvider)
  App.tsx           // Layout scaffold wrapped in ErrorBoundary
```

### Prerequisites

- Node.js **24.x** (the toolchain relies on the `node:` namespace imports shipped in Node 24)
- npm 10+ (installed with Node 24)

Use `nvm install 24 && nvm use 24` to align your local runtime before installing dependencies.

### Getting started

```bash
npm install
npm run dev
```

- Development server runs on <http://localhost:3000>
- `src/main.tsx` mounts the app with `QueryClientProvider` and `RouterProvider`
- Home page demonstrates React Query, Zustand counter state, and shadcn/ui buttons

### Available scripts

| Command                 | Description                                   |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Start Vite in development mode (port 3000)    |
| `npm run build`         | Type-check via `tsc -b` and bundle with Vite  |
| `npm run preview`       | Serve the production build locally            |
| `npm run lint`          | Run ESLint across the project                 |
| `npm run format`        | Format the codebase with Prettier             |
| `npm run format:check`  | Verify formatting without writing changes     |
| `npm run test`          | Execute Vitest in run mode                    |
| `npm run test:watch`    | Run Vitest in watch mode                      |
| `npm run test:coverage` | Generate coverage using `@vitest/coverage-v8` |

### Code quality workflow

- ESLint uses the flat config in `eslint.config.js` with:
    - TypeScript, React Hooks, React Query, and import-order plugins
    - Type-aware import resolution via the `@root` alias
    - Opinionated import sorting (`import/order`) and Prettier integration
- Pre-commit hook (`.husky/pre-commit`) executes `lint-staged`, which runs:
    - `eslint --fix` followed by `prettier --write` on staged TypeScript/JavaScript files
- Run `npm run lint -- --fix` to clean imports/order across the entire repo manually.

### Testing utilities

- Vitest is configured through `vitest.config.ts` with JSDOM, globals, and `src/test/setup.ts`.
- `src/test/test-utils.tsx` exports `renderWithProviders`, wrapping tests in a `QueryClientProvider`.
- Sample tests:
    - `ErrorBoundary.test.tsx` validates the fallback UI
    - `HomePage.test.tsx` demonstrates using Zustand store helpers and the shared renderer

### Styling

- Tailwind configured in `tailwind.config.ts` with the default shadcn/ui design tokens
- Base styles live in `src/index.css`; components use utility classes (`container`, `bg-card`, etc.)
- shadcn/ui button component re-exported via `src/components/ui/index.ts` for ergonomic imports

### Customization tips

- Extend the router by adding new entries to `src/router/routes.ts` and `src/router/index.tsx`.
- Create additional Zustand slices using the `createSelectors` helper for typed selectors.
- Reuse the testing utilities when adding new page or component tests to keep parity.
- If you need SSR or alternative data fetching, replace Vite plugins in `vite.config.ts` and adjust providers in `src/main.tsx`.

### License

MIT – feel free to clone, tweak, and use this template as the foundation for new projects.
