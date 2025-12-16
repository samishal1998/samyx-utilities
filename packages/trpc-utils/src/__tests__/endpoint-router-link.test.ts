import { describe, it, expect, vi } from 'vitest';
import { observable } from '@trpc/server/observable';
import { endpointRouterLink, typedEndpointRouterLink } from '../endpoint-router-link';
import type { TRPCLink, Operation, TRPCClientError } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';

// Mock router type for testing
type MockRouter = AnyRouter;

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

describe('endpointRouterLink', () => {
  it('should route to correct endpoint based on router name', async () => {
    const usedEndpoints: string[] = [];

    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
        billing: '/api/billing',
      },
      linkFactory: (endpoint: string) => {
        usedEndpoints.push(endpoint);
        return () => () =>
          observable((observer) => {
            observer.next({ result: { type: 'data', data: endpoint } } as never);
            observer.complete();
            return () => {};
          });
      },
    });

    const initialized = link({} as never);

    // Request to users router
    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('users.getAll'),
        next: vi.fn() as never,
      }).subscribe({ complete: () => resolve() });
    });

    expect(usedEndpoints).toContain('/api/users');

    // Request to billing router
    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('billing.getInvoices'),
        next: vi.fn() as never,
      }).subscribe({ complete: () => resolve() });
    });

    expect(usedEndpoints).toContain('/api/billing');
  });

  it('should cache initialized links per unique endpoint', async () => {
    const factoryCalls: string[] = [];

    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/shared',
        billing: '/api/shared', // Same endpoint as users
        admin: '/api/admin',
      },
      linkFactory: (endpoint: string) => {
        factoryCalls.push(endpoint);
        return () => () =>
          observable((observer) => {
            observer.complete();
            return () => {};
          });
      },
    });

    const initialized = link({} as never);

    // Multiple requests to routers with same endpoint
    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('users.one'),
        next: vi.fn() as never,
      }).subscribe({ complete: () => resolve() });
    });

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('billing.sub'),
        next: vi.fn() as never,
      }).subscribe({ complete: () => resolve() });
    });

    // Only one link should be created for /api/shared
    expect(factoryCalls.filter((e) => e === '/api/shared').length).toBe(1);
  });

  it('should use defaultEndpoint for unmapped routers', async () => {
    let usedEndpoint = '';

    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
      },
      defaultEndpoint: '/api/default',
      linkFactory: (endpoint: string) => {
        usedEndpoint = endpoint;
        return () => () =>
          observable((observer) => {
            observer.complete();
            return () => {};
          });
      },
    });

    const initialized = link({} as never);

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('unknown.procedure'),
        next: vi.fn() as never,
      }).subscribe({ complete: () => resolve() });
    });

    expect(usedEndpoint).toBe('/api/default');
  });

  it('should emit error for unmapped router without defaultEndpoint', async () => {
    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
      },
    });

    const initialized = link({} as never);
    const errors: TRPCClientError<MockRouter>[] = [];

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('unknown.procedure'),
        next: vi.fn() as never,
      }).subscribe({
        error: (err: TRPCClientError<MockRouter>) => {
          errors.push(err);
          resolve();
        },
        complete: () => resolve(),
      });
    });

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('no endpoint for router "unknown"');
  });

  it('should emit error in strict mode with descriptive message', async () => {
    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
        billing: '/api/billing',
      },
      strict: true,
    });

    const initialized = link({} as never);
    const errors: TRPCClientError<MockRouter>[] = [];

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('unknown.procedure'),
        next: vi.fn() as never,
      }).subscribe({
        error: (err: TRPCClientError<MockRouter>) => {
          errors.push(err);
          resolve();
        },
        complete: () => resolve(),
      });
    });

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('no endpoint mapping for router "unknown"');
    expect(errors[0].message).toContain('no defaultEndpoint provided');
    expect(errors[0].message).toContain('Available mappings:');
  });

  it('should pass linkOptions to default httpBatchLink factory', () => {
    // This test verifies the linkOptions are structured correctly
    // We can't easily test httpBatchLink internals, so we verify the API works
    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
      },
      linkOptions: {
        headers: { 'X-Custom': 'value' },
      },
    });

    // Should not throw
    expect(() => link({} as never)).not.toThrow();
  });

  it('should use custom linkFactory when provided', async () => {
    let customFactoryUsed = false;

    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
      },
      linkFactory: (endpoint: string) => {
        customFactoryUsed = true;
        return () => () =>
          observable((observer) => {
            observer.next({
              result: { type: 'data', data: `custom-${endpoint}` },
            } as never);
            observer.complete();
            return () => {};
          });
      },
    });

    const initialized = link({} as never);

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('users.get'),
        next: vi.fn() as never,
      }).subscribe({ complete: () => resolve() });
    });

    expect(customFactoryUsed).toBe(true);
  });

  it('should handle subscription cleanup', () => {
    let cleanedUp = false;

    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
      },
      linkFactory: () => () => () =>
        observable(() => {
          return () => {
            cleanedUp = true;
          };
        }),
    });

    const initialized = link({} as never);

    const subscription = initialized({
      op: createMockOp('users.get'),
      next: vi.fn() as never,
    }).subscribe({});

    expect(cleanedUp).toBe(false);
    subscription.unsubscribe();
    expect(cleanedUp).toBe(true);
  });

  it('should forward results from the link', async () => {
    const expectedData = { id: 1, name: 'test' };

    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
      },
      linkFactory: () => () => () =>
        observable((observer) => {
          observer.next({ result: { type: 'data', data: expectedData } } as never);
          observer.complete();
          return () => {};
        }),
    });

    const initialized = link({} as never);
    const results: unknown[] = [];

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('users.get'),
        next: vi.fn() as never,
      }).subscribe({
        next: (value: unknown) => results.push(value),
        complete: () => resolve(),
      });
    });

    expect(results.length).toBe(1);
    expect((results[0] as { result: { data: unknown } }).result.data).toEqual(expectedData);
  });

  it('should forward errors from the link', async () => {
    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
      },
      linkFactory: () => () => () =>
        observable((observer) => {
          observer.error(new Error('Network error') as never);
          return () => {};
        }),
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
    expect(errors[0].message).toBe('Network error');
  });

  it('should extract router name correctly from nested paths', async () => {
    let usedEndpoint = '';

    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
      },
      defaultEndpoint: '/api/default',
      linkFactory: (endpoint: string) => {
        usedEndpoint = endpoint;
        return () => () =>
          observable((observer) => {
            observer.complete();
            return () => {};
          });
      },
    });

    const initialized = link({} as never);

    // Deeply nested path
    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('users.profile.settings.get'),
        next: vi.fn() as never,
      }).subscribe({ complete: () => resolve() });
    });

    expect(usedEndpoint).toBe('/api/users');
  });

  it('should support linkFactory returning array of links (chaining)', async () => {
    const executionOrder: string[] = [];

    const link = endpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
      },
      linkFactory: (endpoint: string) => {
        // Return an array of links that will be chained
        const firstLink: TRPCLink<MockRouter> = () => (props) => {
          executionOrder.push(`first-${endpoint}`);
          return props.next(props.op);
        };

        const secondLink: TRPCLink<MockRouter> = () => () =>
          observable((observer) => {
            executionOrder.push(`second-${endpoint}`);
            observer.next({ result: { type: 'data', data: 'chained' } } as never);
            observer.complete();
            return () => {};
          });

        return [firstLink, secondLink];
      },
    });

    const initialized = link({} as never);

    const results: unknown[] = [];

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('users.get'),
        next: vi.fn() as never,
      }).subscribe({
        next: (value: unknown) => results.push(value),
        complete: () => resolve(),
      });
    });

    // Both links should have executed in order
    expect(executionOrder).toEqual(['first-/api/users', 'second-/api/users']);
    expect(results.length).toBe(1);
    expect((results[0] as { result: { data: string } }).result.data).toBe('chained');
  });
});

describe('typedEndpointRouterLink', () => {
  it('should work the same as endpointRouterLink', async () => {
    let usedEndpoint = '';

    const link = typedEndpointRouterLink<MockRouter>({
      routerToEndpoint: {
        users: '/api/users',
      },
      defaultEndpoint: '/api/default',
      linkFactory: (endpoint: string) => {
        usedEndpoint = endpoint;
        return () => () =>
          observable((observer) => {
            observer.complete();
            return () => {};
          });
      },
    });

    const initialized = link({} as never);

    await new Promise<void>((resolve) => {
      initialized({
        op: createMockOp('users.get'),
        next: vi.fn() as never,
      }).subscribe({ complete: () => resolve() });
    });

    expect(usedEndpoint).toBe('/api/users');
  });
});
