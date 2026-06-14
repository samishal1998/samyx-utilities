import { observable } from '@trpc/server/observable';
import { TRPCClientError, type TRPCLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import type { AnyClientTypes } from '@trpc/server/unstable-core-do-not-import';
import {
  defaultTransformer,
  getDataTransformer,
  transformResult,
} from '@trpc/server/unstable-core-do-not-import';
import type { ControlledLinkOptions } from './types';

/**
 * A terminal link that delegates requests to a user-provided handler.
 */
export function controlledLink<
  TRouter extends AnyRouter = AnyRouter,
  TRoot extends AnyClientTypes = TRouter['_def']['_config']['$types'],
  TContext = unknown,
  TExtra = unknown,
  TMeta extends Record<string, unknown> | undefined =
    | Record<string, unknown>
    | undefined,
>(
  opts: ControlledLinkOptions<TRoot, TContext, TExtra, TMeta>,
): TRPCLink<TRouter> {
  const transformer = getDataTransformer(
    opts.transformer ?? defaultTransformer,
  );

  return () => {
    return (operationOpts) => {
      const { op } = operationOpts;
      return observable((observer) => {
        const { type } = op;
        if (type === 'subscription') {
          throw new Error(
            'Subscriptions are unsupported by `controlledLink` - use `httpSubscriptionLink` or `wsLink`',
          );
        }

        let meta: TMeta | undefined;

        Promise.resolve()
          .then(async () => {
            const ctx = opts.createContext
              ? await opts.createContext({ op, extra: opts.extra })
              : (undefined as TContext);

            const result = await opts.handler({
              op,
              ctx,
              extra: opts.extra,
            });

            meta = result.meta;
            const transformed = transformResult(
              result.json as never,
              transformer.output,
            );

            if (!transformed.ok) {
              observer.error(
                TRPCClientError.from(transformed.error, {
                  meta,
                }),
              );
              return;
            }

            observer.next({
              context: meta,
              result: transformed.result,
            });
            observer.complete();
          })
          .catch((cause) => {
            observer.error(TRPCClientError.from(cause, { meta }));
          });

        return () => {
          // noop
        };
      });
    };
  };
}

export type {
  ControlledLinkOptions,
  ControlledLinkContextFactory,
  ControlledLinkContextFactoryOptions,
  ControlledLinkHandler,
  ControlledLinkHandlerOptions,
  ControlledLinkHandlerResult,
} from './types.js';
