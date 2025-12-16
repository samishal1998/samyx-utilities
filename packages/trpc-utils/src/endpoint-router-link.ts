import { observable } from '@trpc/server/observable';
import { httpBatchLink, TRPCClientError, type TRPCLink, type OperationLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { createChain } from './create-chain';
import type {
  EndpointRouterLinkOptions,
  TypedEndpointRouterLinkOptions,
  LinkFactory,
  LinkOrLinks,
} from './types';

/**
 * Converts a single link or array of links to an array.
 */
function asArray<TRouter extends AnyRouter>(
  value: LinkOrLinks<TRouter>
): TRPCLink<TRouter>[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Creates a link that routes requests to different endpoints based on the router name.
 * The router name is extracted from the first segment of the procedure path.
 *
 * The linkFactory can return a single link or an array of links that will be chained.
 *
 * @example
 * ```ts
 * // Basic usage
 * const link = endpointRouterLink<AppRouter>({
 *   routerToEndpoint: {
 *     users: '/api/users-service/trpc',
 *     billing: 'https://billing.internal/trpc',
 *   },
 *   defaultEndpoint: '/api/trpc',
 * });
 *
 * // With custom link factory returning a chain
 * const link = endpointRouterLink<AppRouter>({
 *   routerToEndpoint: { ... },
 *   linkFactory: (endpoint) => [
 *     loggerLink(),
 *     httpBatchLink({ url: endpoint }),
 *   ],
 * });
 *
 * // With link options
 * const link = endpointRouterLink<AppRouter>({
 *   routerToEndpoint: { ... },
 *   defaultEndpoint: '/api/trpc',
 *   linkOptions: {
 *     headers: () => ({ Authorization: `Bearer ${getToken()}` }),
 *   },
 * });
 * ```
 */
export function endpointRouterLink<
  TRouter extends AnyRouter,
  TMapping extends Record<string, string> = Record<string, string>,
>(opts: EndpointRouterLinkOptions<TRouter, TMapping>): TRPCLink<TRouter> {
  const {
    routerToEndpoint,
    defaultEndpoint,
    strict = false,
    linkFactory,
    linkOptions = {},
  } = opts;

  // Default link factory uses httpBatchLink
  // We use type assertions here because httpBatchLink's complex generic
  // types don't always infer correctly with dynamic linkOptions
  const createLink: LinkFactory<TRouter> =
    linkFactory ??
    ((endpoint: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return httpBatchLink({
        url: endpoint,
        ...linkOptions,
      } as any) as TRPCLink<TRouter>;
    });

  return (runtime) => {
    // Cache for initialized link chains, keyed by endpoint URL
    const linkCache = new Map<string, OperationLink<TRouter>[]>();

    const getInitializedLinks = (endpoint: string): OperationLink<TRouter>[] => {
      let initializedLinks = linkCache.get(endpoint);

      if (!initializedLinks) {
        const linksOrLink = createLink(endpoint);
        const links = asArray(linksOrLink);
        initializedLinks = links.map((link) => link(runtime));
        linkCache.set(endpoint, initializedLinks);
      }

      return initializedLinks;
    };

    return (props) => {
      return observable((observer) => {
        const { op } = props;
        const routerName = op.path.split('.')[0];
        const endpoint =
          (routerToEndpoint as Record<string, string>)[routerName] ??
          defaultEndpoint;

        if (!endpoint) {
          const availableMappings = Object.keys(routerToEndpoint).join(', ');
          const errorMessage = strict
            ? `endpointRouterLink: no endpoint mapping for router "${routerName}" ` +
              `and no defaultEndpoint provided. ` +
              `Available mappings: ${availableMappings || '(none)'}`
            : `endpointRouterLink: no endpoint for router "${routerName}". ` +
              `Either add it to routerToEndpoint or provide a defaultEndpoint.`;

          observer.error(TRPCClientError.from(new Error(errorMessage)));
          return;
        }

        const links = getInitializedLinks(endpoint);

        // Use createChain to execute the link chain
        return createChain({ op, links }).subscribe(observer);
      });
    };
  };
}

/**
 * Type-safe version of endpointRouterLink that extracts router names from AppRouter.
 * Provides compile-time validation that router names match the AppRouter definition.
 *
 * @example
 * ```ts
 * // TypeScript will suggest/validate router names based on your AppRouter
 * const link = typedEndpointRouterLink<AppRouter>({
 *   routerToEndpoint: {
 *     users: '/api/users',    // TS validates 'users' exists in AppRouter
 *     billing: '/api/billing', // TS validates 'billing' exists in AppRouter
 *   },
 *   defaultEndpoint: '/api/trpc',
 * });
 * ```
 */
export function typedEndpointRouterLink<TRouter extends AnyRouter>(
  opts: TypedEndpointRouterLinkOptions<TRouter>
): TRPCLink<TRouter> {
  return endpointRouterLink(
    opts as EndpointRouterLinkOptions<TRouter, Record<string, string>>
  );
}

export type {
  EndpointRouterLinkOptions,
  TypedEndpointRouterLinkOptions,
  LinkFactory,
  LinkFactoryOptions,
  LinkOrLinks,
} from './types.js';
