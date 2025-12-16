import { describe, it, expect } from 'vitest';
import type { RouterNames, RequiredRouterMapping, PartialRouterMapping } from '../router-utils';
import type { AnyRouter } from '@trpc/server';

// Mock AppRouter type for testing type inference
type MockProcedures = {
  'users.getAll': unknown;
  'users.getById': unknown;
  'billing.getInvoices': unknown;
  'billing.createInvoice': unknown;
  'admin.getStats': unknown;
};

// Use AnyRouter with procedure override for type-level testing
type MockRouter = AnyRouter & {
  _def: {
    procedures: MockProcedures;
  };
};

describe('RouterNames type utility', () => {
  it('should extract unique router names from procedure paths', () => {
    // Type-level test - this validates at compile time
    // If RouterNames doesn't work, this would be a TS error
    const testRouterName = (name: RouterNames<MockRouter>) => name;

    // These should compile - validates that RouterNames extracts 'users', 'billing', 'admin'
    expect(testRouterName('users')).toBe('users');
    expect(testRouterName('billing')).toBe('billing');
    expect(testRouterName('admin')).toBe('admin');
  });
});

describe('RequiredRouterMapping type utility', () => {
  it('should require all router names as keys', () => {
    // Type-level test - validates that all keys are required
    const validMapping: RequiredRouterMapping<MockRouter> = {
      users: '/api/users',
      billing: '/api/billing',
      admin: '/api/admin',
    };

    expect(validMapping.users).toBe('/api/users');
    expect(validMapping.billing).toBe('/api/billing');
    expect(validMapping.admin).toBe('/api/admin');
  });
});

describe('PartialRouterMapping type utility', () => {
  it('should allow partial router name mapping', () => {
    // Type-level test - validates that keys are optional
    const partialMapping: PartialRouterMapping<MockRouter> = {
      users: '/api/users',
      // billing and admin are optional
    };

    expect(partialMapping.users).toBe('/api/users');
    expect(partialMapping.billing).toBeUndefined();
  });
});
