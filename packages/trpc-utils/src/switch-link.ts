import { observable } from '@trpc/server/observable';
import { TRPCClientError, type TRPCLink, type OperationLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { createChain } from './create-chain';
import type { SwitchLinkOptions, SwitchLinkSelectorContext, LinkOrLinks } from './types';

/**
 * Converts a single link or array of links to an array.
 */
function asArray<TRouter extends AnyRouter>(
  value: LinkOrLinks<TRouter>
): TRPCLink<TRouter>[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Creates a multi-way routing link that selects from multiple cases based on a selector function.
 * Unlike splitLink (binary), switchLink supports any number of branches with compile-time exhaustiveness.
 *
 * Each case can be a single link or an array of links that will be chained together.
 *
 * @example
 * ```ts
 * type RouteKey = 'public' | 'private' | 'admin';
 *
 * const link = switchLink<AppRouter, RouteKey>({
 *   select: ({ path, ctx }) => {
 *     if ((ctx as any).isAdmin) return 'admin';
 *     if (path.startsWith('public.')) return 'public';
 *     return 'private';
 *   },
 *   cases: {
 *     // Single link
 *     public: httpBatchLink({ url: '/api/public' }),
 *     // Array of links (chained)
 *     private: [
 *       loggerLink(),
 *       httpBatchLink({ url: '/api/private' }),
 *     ],
 *     admin: httpBatchLink({ url: '/api/admin' }),
 *   },
 * });
 * ```
 */
export function switchLink<
  TRouter extends AnyRouter,
  K extends string,
  TContext = unknown,
>(opts: SwitchLinkOptions<TRouter, K, TContext>): TRPCLink<TRouter> {
  const caseKeys = Object.keys(opts.cases) as K[];

  if (caseKeys.length === 0) {
    throw new Error('switchLink: cases object must have at least one entry');
  }

  return (runtime) => {
    // Initialize all link chains once at runtime creation (CACHING)
    const initializedChains = new Map<K, OperationLink<TRouter>[]>();

    for (const key of caseKeys) {
      const linksOrLink = opts.cases[key];
      const links = asArray(linksOrLink);
      const initializedLinks = links.map((link) => link(runtime));
      initializedChains.set(key, initializedLinks);
    }

    return (props) => {
      return observable((observer) => {
        const { op } = props;

        const selectorContext: SwitchLinkSelectorContext<TContext> = {
          path: op.path,
          type: op.type,
          ctx: op.context as TContext,
          op,
        };

        const selectedKey = opts.select(selectorContext);
        const links = initializedChains.get(selectedKey);

        if (!links) {
          const validKeys = Array.from(initializedChains.keys()).join(', ');
          observer.error(
            TRPCClientError.from(
              new Error(
                `switchLink: selector returned unknown key "${selectedKey}". ` +
                  `Valid keys are: ${validKeys}`
              )
            )
          );
          return;
        }

        // Use createChain to execute the link chain
        return createChain({ op, links }).subscribe(observer);
      });
    };
  };
}

export type { SwitchLinkOptions, SwitchLinkSelectorContext, LinkOrLinks } from './types.js';
