import { describe, it, expect, vi } from 'vitest';
import { controlledLink } from '../controlled-link';
import type { Operation } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';

type MockRouter = AnyRouter;

const createMockOp = (
  path: string,
  context: Record<string, unknown> = {},
  type: Operation['type'] = 'query',
): Operation => ({
  id: 1,
  type,
  path,
  input: undefined,
  context,
  signal: new AbortController().signal,
});

describe('controlledLink', () => {
  it('should build context and pass extra to handler', async () => {
    const extra = { token: 'abc-123' };
    const createdContexts: Array<{ token: string; path: string }> = [];

    const createContext = vi.fn(
      async ({ op, extra: ctxExtra }: { op: Operation; extra?: unknown }) => {
        const typedExtra = ctxExtra as typeof extra | undefined;
        const ctx = { token: typedExtra?.token ?? '', path: op.path };
        createdContexts.push(ctx);
        return ctx;
      },
    );

    const handler = vi.fn(
      async ({
        ctx,
        extra: handlerExtra,
      }: {
        ctx: unknown;
        extra?: unknown;
      }) => {
        const typedCtx = ctx as { token: string; path: string };
        const typedExtra = handlerExtra as typeof extra | undefined;
        return {
          json: {
            result: {
              data: {
                ctx: typedCtx,
                extra: typedExtra,
              },
            },
          },
          meta: {
            source: 'handler',
          },
        };
      },
    );

    const link = controlledLink<MockRouter>({
      createContext,
      handler,
      extra,
    });

    const initialized = link({} as never);
    const results: unknown[] = [];

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('users.get'),
        next: vi.fn() as never,
      }).subscribe({
        next: (value: unknown) => results.push(value),
        error: () => resolve(),
        complete: () => resolve(),
      });
    });

    expect(createContext).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(createdContexts[0]).toEqual({ token: 'abc-123', path: 'users.get' });

    const result = results[0] as {
      result: { data: { ctx: unknown; extra: unknown } };
      context: Record<string, unknown> | undefined;
    };

    expect(result.result.data.ctx).toEqual({
      token: 'abc-123',
      path: 'users.get',
    });
    expect(result.result.data.extra).toEqual(extra);
    expect(result.context).toEqual({ source: 'handler' });
  });

  it('should surface handler errors', async () => {
    const link = controlledLink<MockRouter>({
      handler: async () => {
        throw new Error('boom');
      },
    });

    const initialized = link({} as never);
    const errors: Error[] = [];

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('users.get'),
        next: vi.fn() as never,
      }).subscribe({
        error: (err: Error) => {
          errors.push(err);
          resolve();
        },
        complete: () => resolve(),
      });
    });

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('boom');
  });
});
