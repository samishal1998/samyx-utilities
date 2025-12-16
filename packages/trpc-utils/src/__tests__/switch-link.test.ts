import { describe, it, expect, vi } from 'vitest';
import { observable } from '@trpc/server/observable';
import { switchLink } from '../switch-link';
import type { TRPCLink, Operation, TRPCClientError } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';

// Mock router type for testing
type MockRouter = AnyRouter;

// Helper to create a mock link that returns a specific response
const createMockLink = <T>(response: T): TRPCLink<MockRouter> => {
  return () => () =>
    observable((observer) => {
      observer.next({ result: { type: 'data', data: response } } as never);
      observer.complete();
      return () => {};
    });
};

// Helper to create a mock operation
const createMockOp = (
  path: string,
  context: Record<string, unknown> = {}
): Operation => ({
  id: 1,
  type: 'query',
  path,
  input: undefined,
  context,
  signal: new AbortController().signal,
});

describe('switchLink', () => {
  it('should route to correct case based on selector', () => {
    type RouteKey = 'a' | 'b';

    const linkA = vi.fn(createMockLink('response-a'));
    const linkB = vi.fn(createMockLink('response-b'));

    const link = switchLink<MockRouter, RouteKey>({
      select: ({ path }: { path: string }) => (path.startsWith('routerA') ? 'a' : 'b'),
      cases: { a: linkA, b: linkB },
    });

    // Initialize the link
    const initialized = link({} as never);

    // Both links should be initialized
    expect(linkA).toHaveBeenCalledTimes(1);
    expect(linkB).toHaveBeenCalledTimes(1);
  });

  it('should cache initialized links and not recreate them', () => {
    type RouteKey = 'cached';

    let factoryCallCount = 0;
    const linkFactory: TRPCLink<MockRouter> = () => {
      factoryCallCount++;
      return () =>
        observable((observer) => {
          observer.next({ result: { type: 'data', data: 'cached' } } as never);
          observer.complete();
          return () => {};
        });
    };

    const link = switchLink<MockRouter, RouteKey>({
      select: () => 'cached',
      cases: { cached: linkFactory },
    });

    // Initialize the link
    const initialized = link({} as never);

    // Factory should be called once during initialization
    expect(factoryCallCount).toBe(1);

    // Multiple operations should not create new links
    initialized({ op: createMockOp('test.one'), next: vi.fn() as never });
    initialized({ op: createMockOp('test.two'), next: vi.fn() as never });

    // Factory should still only have been called once
    expect(factoryCallCount).toBe(1);
  });

  it('should throw if cases object is empty', () => {
    expect(() => {
      switchLink<MockRouter, never>({
        select: () => '' as never,
        cases: {} as never,
      });
    }).toThrow('cases object must have at least one entry');
  });

  it('should emit error if selector returns unknown key', async () => {
    type RouteKey = 'known';

    const link = switchLink<MockRouter, RouteKey>({
      select: () => 'unknown' as RouteKey,
      cases: { known: createMockLink('known') },
    });

    const initialized = link({} as never);

    const errors: TRPCClientError<MockRouter>[] = [];

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('test.procedure'),
        next: vi.fn() as never,
      }).subscribe({
        next: () => {},
        error: (err: TRPCClientError<MockRouter>) => {
          errors.push(err);
          resolve();
        },
        complete: () => resolve(),
      });
    });

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('unknown key "unknown"');
    expect(errors[0].message).toContain('Valid keys are: known');
  });

  it('should pass context to selector', async () => {
    type RouteKey = 'admin' | 'user';

    interface MyContext {
      isAdmin: boolean;
    }

    const adminLink = createMockLink('admin-response');
    const userLink = createMockLink('user-response');

    let receivedContext: MyContext | undefined;

    const link = switchLink<MockRouter, RouteKey, MyContext>({
      select: ({ ctx }: { ctx: MyContext }) => {
        receivedContext = ctx;
        return ctx.isAdmin ? 'admin' : 'user';
      },
      cases: { admin: adminLink, user: userLink },
    });

    const initialized = link({} as never);

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('test.procedure', { isAdmin: true }),
        next: vi.fn() as never,
      }).subscribe({
        complete: () => resolve(),
        error: () => resolve(),
      });
    });

    expect(receivedContext).toEqual({ isAdmin: true });
  });

  it('should forward results from selected link', async () => {
    type RouteKey = 'target';

    const expectedData = { id: 1, name: 'test' };
    const link = switchLink<MockRouter, RouteKey>({
      select: () => 'target',
      cases: { target: createMockLink(expectedData) },
    });

    const initialized = link({} as never);

    const results: unknown[] = [];

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('test.procedure'),
        next: vi.fn() as never,
      }).subscribe({
        next: (value: unknown) => results.push(value),
        complete: () => resolve(),
        error: () => resolve(),
      });
    });

    expect(results.length).toBe(1);
    expect((results[0] as { result: { data: unknown } }).result.data).toEqual(expectedData);
  });

  it('should forward errors from selected link', async () => {
    type RouteKey = 'error';

    const errorLink: TRPCLink<MockRouter> = () => () =>
      observable((observer) => {
        observer.error(new Error('Link error') as never);
        return () => {};
      });

    const link = switchLink<MockRouter, RouteKey>({
      select: () => 'error',
      cases: { error: errorLink },
    });

    const initialized = link({} as never);

    const errors: Error[] = [];

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('test.procedure'),
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
    expect(errors[0].message).toBe('Link error');
  });

  it('should handle subscription cleanup', () => {
    type RouteKey = 'cleanup';

    let cleanedUp = false;
    const cleanupLink: TRPCLink<MockRouter> = () => () =>
      observable(() => {
        return () => {
          cleanedUp = true;
        };
      });

    const link = switchLink<MockRouter, RouteKey>({
      select: () => 'cleanup',
      cases: { cleanup: cleanupLink },
    });

    const initialized = link({} as never);

    const subscription = initialized({
      op: createMockOp('test.procedure'),
      next: vi.fn() as never,
    }).subscribe({});

    expect(cleanedUp).toBe(false);
    subscription.unsubscribe();
    expect(cleanedUp).toBe(true);
  });

  it('should support array of links (chaining)', async () => {
    type RouteKey = 'chained';

    const executionOrder: string[] = [];

    // First link in chain - passes through to next
    const firstLink: TRPCLink<MockRouter> = () => (props) => {
      executionOrder.push('first');
      return props.next(props.op);
    };

    // Second link in chain - terminates with response
    const secondLink: TRPCLink<MockRouter> = () => () =>
      observable((observer) => {
        executionOrder.push('second');
        observer.next({ result: { type: 'data', data: 'chained-response' } } as never);
        observer.complete();
        return () => {};
      });

    const link = switchLink<MockRouter, RouteKey>({
      select: () => 'chained',
      cases: {
        // Array of links - will be chained together
        chained: [firstLink, secondLink],
      },
    });

    const initialized = link({} as never);

    const results: unknown[] = [];

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('test.procedure'),
        next: vi.fn() as never,
      }).subscribe({
        next: (value: unknown) => results.push(value),
        complete: () => resolve(),
        error: () => resolve(),
      });
    });

    // Both links should have executed in order
    expect(executionOrder).toEqual(['first', 'second']);
    expect(results.length).toBe(1);
    expect((results[0] as { result: { data: string } }).result.data).toBe('chained-response');
  });

  it('should support mixed single and array cases', () => {
    type RouteKey = 'single' | 'array';

    const singleLink = vi.fn(createMockLink('single'));
    const arrayLink1 = vi.fn(createMockLink('array1'));
    const arrayLink2 = vi.fn(createMockLink('array2'));

    const link = switchLink<MockRouter, RouteKey>({
      select: ({ path }: { path: string }) => (path.startsWith('single') ? 'single' : 'array'),
      cases: {
        single: singleLink,
        array: [arrayLink1, arrayLink2],
      },
    });

    // Initialize the link
    link({} as never);

    // All links should be initialized
    expect(singleLink).toHaveBeenCalledTimes(1);
    expect(arrayLink1).toHaveBeenCalledTimes(1);
    expect(arrayLink2).toHaveBeenCalledTimes(1);
  });
});
