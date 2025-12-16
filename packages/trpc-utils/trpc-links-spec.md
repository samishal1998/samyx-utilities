
# tRPC Multi-Link System: `switchLink` and `endpointRouterLink`

This document describes two advanced link utilities for **tRPC v11** clients:

- **`switchLink`** — a multi-way, type-safe router selector (like `splitLink`, but exhaustive)
- **`endpointRouterLink`** — a dynamic endpoint router that sends requests to different base URLs depending on the tRPC router name

These patterns are ideal for modular monorepos, distributed APIs, and advanced deployment setups (e.g., hybrid edge/core routing).

---

## 1. `switchLink`: Multi-way Type-Safe Routing

### Purpose
`switchLink` is a multi-branch replacement for `splitLink`. It routes requests based on a **selector function**, allowing for multiple routing paths with full **TypeScript exhaustiveness checking**.

### Implementation

```ts
import type { TRPCLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';

type ExhaustiveRecord<K extends string, V> = Record<K, V> & { __exhaustive?: never };
export type RouteKey = 'public' | 'private' | 'admin';

export function switchLink<TRouter extends AnyRouter, K extends string>(opts: {
  select: (arg: { path: string; type: string; ctx: unknown }) => K;
  cases: ExhaustiveRecord<K, TRPCLink<TRouter>>;
}): TRPCLink<TRouter> {
  return () => {
    return ({ op, next, runtime }) => {
      const key = opts.select({ path: op.path, type: op.type, ctx: op.context });
      const chosen = opts.cases[key];
      const inner = chosen();
      return inner({ op, next, runtime });
    };
  };
}
```

### Example Usage

```ts
import { createTRPCClient } from '@trpc/client';
import type { AppRouter } from './server/router';
import { loggerLink } from '@trpc/client/links/loggerLink';
import { httpBatchLink } from '@trpc/client/links/httpBatchLink';
import { switchLink, RouteKey } from '@/libs/trpc/links/switchLink';

type MyKey = RouteKey;

const cases = {
  public: httpBatchLink<AppRouter>({ url: '/api/trpc-public' }),
  private: httpBatchLink<AppRouter>({ url: '/api/trpc' }),
  admin: httpBatchLink<AppRouter>({ url: '/api/trpc-admin' }),
} satisfies Record<MyKey, ReturnType<typeof httpBatchLink<AppRouter>>>;

export const trpc = createTRPCClient<AppRouter>({
  links: [
    loggerLink(),
    switchLink<AppRouter, MyKey>({
      select: ({ path, ctx }) => {
        if ((ctx as any)?.isAdmin) return 'admin';
        const head = path.split('.')[0];
        if (head === 'auth' || head === 'publicInfo') return 'public';
        return 'private';
      },
      cases,
    }),
  ],
});
```

---

## 2. `endpointRouterLink`: Router-to-Endpoint Mapping

### Purpose
`endpointRouterLink` dynamically assigns requests to HTTP endpoints based on the **router name** (the first segment in the procedure path).

### Implementation

```ts
import type { TRPCLink } from '@trpc/client';
import { httpBatchLink } from '@trpc/client/links/httpBatchLink';
import type { AnyRouter } from '@trpc/server';

type RouterName = string;

export function endpointRouterLink<TRouter extends AnyRouter, Map extends Record<RouterName, string>>(opts: {
  routerToEndpoint: Map;
  defaultEndpoint?: string;
  strict?: boolean;
}): TRPCLink<TRouter> {
  const linkCache = new Map<string, TRPCLink<TRouter>>();
  const getLinkForEndpoint = (endpoint: string): TRPCLink<TRouter> => {
    let l = linkCache.get(endpoint);
    if (!l) {
      l = httpBatchLink<TRouter>({ url: endpoint });
      linkCache.set(endpoint, l);
    }
    return l;
  };

  return () => {
    return ({ op, next, runtime }) => {
      const [routerHead] = op.path.split('.', 1);
      const endpoint =
        (opts.routerToEndpoint as Record<string, string>)[routerHead] ??
        opts.defaultEndpoint;

      if (!endpoint) {
        if (opts.strict) {
          throw new Error(
            `endpointRouterLink: no endpoint mapping for router "${routerHead}" and no defaultEndpoint`
          );
        }
        return next(op);
      }

      const inner = getLinkForEndpoint(endpoint)();
      return inner({ op, next, runtime });
    };
  };
}
```

### Example Usage

```ts
import { createTRPCClient } from '@trpc/client';
import type { AppRouter } from './server/router';
import { loggerLink } from '@trpc/client/links/loggerLink';
import { endpointRouterLink } from '@/libs/trpc/links/endpointRouterLink';

const routerToEndpoint = {
  users: '/api/trpc-users',
  billing: '/api/trpc-billing',
  files: 'https://files.internal/trpc',
  admin: '/api/trpc-admin',
} as const;

export const trpc = createTRPCClient<AppRouter>({
  links: [
    loggerLink(),
    endpointRouterLink<AppRouter, typeof routerToEndpoint>({
      routerToEndpoint,
      strict: true,
    }),
  ],
});
```

---

## Technical Notes

### Type Safety & Exhaustiveness
- `switchLink` enforces **compile-time coverage** for all branches.
- `endpointRouterLink` ensures all router names are accounted for if `strict: true`.

### Batching Behavior
- Each endpoint has its own `httpBatchLink`, so requests to the same endpoint are batched together; different endpoints batch independently.

### Environment Agnostic
- Works in **browser**, **server**, or hybrid edge runtimes.
- For per-request headers, replace `url` with `{ url, headers() { ... } }`.

### Multi-Environment Compatibility
- Compute endpoint registries dynamically via `process.env` or runtime context.
- Still type-safe if the registry object is declared `as const`.

### Versions
- Works with **tRPC v10** and **v11**.
- Compatible with **Next.js 14/15**, Pages or App Router.

---

## Recommended Additions

- **Unit test** with `assertNever` to ensure selector branches are exhaustive.
- **Registry linter** to verify all routers in your `AppRouter` are mapped.
- Optional `metricsLink` before these for logging latency per endpoint.
