import type { TRPCLink, Operation } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';

/**
 * A single link or an array of links that will be chained together.
 */
export type LinkOrLinks<TRouter extends AnyRouter> =
  | TRPCLink<TRouter>
  | TRPCLink<TRouter>[];

/**
 * Extract top-level router names from a tRPC AppRouter type.
 * Extracts the first segment from procedure paths like "users.getAll" -> "users"
 */
export type RouterNames<TRouter extends AnyRouter> =
  keyof TRouter['_def']['procedures'] extends infer K
    ? K extends string
      ? K extends `${infer First}.${string}`
        ? First
        : K
      : never
    : never;

/**
 * Full mapping type requiring all router names to be mapped.
 */
export type RequiredRouterMapping<TRouter extends AnyRouter> = {
  [K in RouterNames<TRouter>]: string;
};

/**
 * Partial mapping type allowing some router names to be unmapped.
 */
export type PartialRouterMapping<TRouter extends AnyRouter> =
  Partial<RequiredRouterMapping<TRouter>>;

/**
 * Selector function context for switchLink.
 */
export interface SwitchLinkSelectorContext<TContext = unknown> {
  /** The full procedure path (e.g., "users.getAll") */
  path: string;
  /** The operation type */
  type: 'query' | 'mutation' | 'subscription';
  /** The operation context */
  ctx: TContext;
  /** The full operation object */
  op: Operation;
}

/**
 * Link factory function type for creating links dynamically.
 * Can return a single link or an array of links that will be chained.
 */
export type LinkFactory<TRouter extends AnyRouter> = (
  endpoint: string
) => LinkOrLinks<TRouter>;

/**
 * Options for creating links with full customization.
 */
export interface LinkFactoryOptions {
  url: string;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  fetch?: typeof fetch;
  [key: string]: unknown;
}

/**
 * Configuration for switchLink.
 */
export interface SwitchLinkOptions<
  TRouter extends AnyRouter,
  K extends string,
  TContext = unknown,
> {
  /**
   * Selector function that determines which case to use for each operation.
   * Must return one of the keys defined in `cases`.
   */
  select: (context: SwitchLinkSelectorContext<TContext>) => K;

  /**
   * Map of case keys to their corresponding links.
   * Each case can be a single link or an array of links that will be chained.
   * TypeScript enforces that ALL keys in union K must be present.
   */
  cases: { [P in K]: LinkOrLinks<TRouter> };
}

/**
 * Configuration for endpointRouterLink.
 */
export interface EndpointRouterLinkOptions<
  TRouter extends AnyRouter,
  TMapping extends Record<string, string>,
> {
  /** Map of router names to endpoint URLs */
  routerToEndpoint: TMapping;
  /** Default endpoint for unmapped routers */
  defaultEndpoint?: string;
  /** If true, throws an error for unmapped routers without a defaultEndpoint */
  strict?: boolean;
  /** Custom link factory function (defaults to httpBatchLink) */
  linkFactory?: LinkFactory<TRouter>;
  /** Options passed to the default link factory (headers, fetch, etc.) */
  linkOptions?: Omit<LinkFactoryOptions, 'url'>;
}

/**
 * Type-safe configuration that extracts router names from AppRouter.
 */
export interface TypedEndpointRouterLinkOptions<
  TRouter extends AnyRouter,
  TRouterNames extends string = RouterNames<TRouter>,
> {
  /** Map of router names to endpoint URLs (type-safe with AppRouter) */
  routerToEndpoint: Partial<Record<TRouterNames, string>> & Record<string, string>;
  /** Default endpoint for unmapped routers */
  defaultEndpoint?: string;
  /** If true, throws an error for unmapped routers without a defaultEndpoint */
  strict?: boolean;
  /** Custom link factory function (defaults to httpBatchLink) */
  linkFactory?: LinkFactory<TRouter>;
  /** Options passed to the default link factory (headers, fetch, etc.) */
  linkOptions?: Omit<LinkFactoryOptions, 'url'>;
}
