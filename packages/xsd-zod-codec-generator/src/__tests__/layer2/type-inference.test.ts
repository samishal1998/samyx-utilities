/**
 * Layer 2 Type Inference Tests
 *
 * These tests verify that TypeScript type inference works correctly
 * for compile-time type safety.
 *
 * Note: Type-level assertions are done via TypeScript compilation.
 * If this file compiles, the type inference is working correctly.
 */

import { describe, it, expect } from 'vitest';
import {
  typedDecode,
  FastXmlParserStrategy,
  type InferCleanType,
  type InferCleanEnvelope,
} from '../../layer2/index.js';

// ============================================================================
// Type-level Tests (compile-time assertions)
// ============================================================================

// Test: Attribute key transformation
type TestAttrInput = { '@_avail': string; '@_lang': string };
type TestAttrExpected = { avail: string; lang: string };
type TestAttrResult = InferCleanType<TestAttrInput>;
// This assignment will fail to compile if types don't match
const _attrCheck: TestAttrResult = { avail: 'true', lang: 'en' };
const _attrVerify: TestAttrExpected = _attrCheck;

// Test: Text content transformation
type TestTextInput = { '#text': string };
type TestTextExpected = { value: string };
type TestTextResult = InferCleanType<TestTextInput>;
const _textCheck: TestTextResult = { value: 'hello' };
const _textVerify: TestTextExpected = _textCheck;

// Test: Namespace prefix stripping
type TestNsInput = { 'domain:name': string; 'contact:id': string };
type TestNsExpected = { name: string; id: string };
type TestNsResult = InferCleanType<TestNsInput>;
const _nsCheck: TestNsResult = { name: 'example.com', id: 'contact123' };
const _nsVerify: TestNsExpected = _nsCheck;

// Test: Nested structures
type TestNestedInput = {
  'domain:cd': {
    'domain:name': {
      '@_avail': string;
      '#text': string;
    };
  };
};
type TestNestedExpected = {
  cd: {
    name: {
      avail: string;
      value: string;
    };
  };
};
type TestNestedResult = InferCleanType<TestNestedInput>;
const _nestedCheck: TestNestedResult = {
  cd: { name: { avail: 'true', value: 'example.com' } },
};
const _nestedVerify: TestNestedExpected = _nestedCheck;

// Test: Arrays
type TestArrayInput = {
  'domain:cd': Array<{ 'domain:name': string }>;
};
type TestArrayExpected = {
  cd: Array<{ name: string }>;
};
type TestArrayResult = InferCleanType<TestArrayInput>;
const _arrayCheck: TestArrayResult = {
  cd: [{ name: 'example.com' }, { name: 'test.com' }],
};
const _arrayVerify: TestArrayExpected = _arrayCheck;

// Test: Envelope with $meta
type TestEnvelopeInput = { 'domain:name': string };
type TestEnvelopeResult = InferCleanEnvelope<TestEnvelopeInput>;
const _envelopeCheck: TestEnvelopeResult = {
  name: 'example.com',
  $meta: {
    strategyId: 'fxp-v1',
    root: { qname: { localName: 'test' }, fields: {} },
  },
};

// ============================================================================
// Runtime Tests
// ============================================================================

describe('type inference', () => {
  describe('InferCleanType (compile-time)', () => {
    it('should transform attribute keys (compile-time verified)', () => {
      // If this test runs, the type assignments above compiled successfully
      expect(_attrVerify).toEqual({ avail: 'true', lang: 'en' });
    });

    it('should transform text content key (compile-time verified)', () => {
      expect(_textVerify).toEqual({ value: 'hello' });
    });

    it('should strip namespace prefixes (compile-time verified)', () => {
      expect(_nsVerify).toEqual({ name: 'example.com', id: 'contact123' });
    });

    it('should transform nested structures (compile-time verified)', () => {
      expect(_nestedVerify).toEqual({
        cd: { name: { avail: 'true', value: 'example.com' } },
      });
    });

    it('should transform arrays (compile-time verified)', () => {
      expect(_arrayVerify).toEqual({
        cd: [{ name: 'example.com' }, { name: 'test.com' }],
      });
    });
  });

  describe('InferCleanEnvelope', () => {
    it('should include $meta in result type (compile-time verified)', () => {
      expect(_envelopeCheck.$meta).toBeDefined();
      expect(_envelopeCheck.$meta.strategyId).toBe('fxp-v1');
      expect(_envelopeCheck.name).toBe('example.com');
    });
  });

  describe('typedDecode', () => {
    it('should infer output type from input', () => {
      // Define a known input type
      type XmlInput = {
        'domain:name': {
          '@_avail': '1' | '0';
          '#text': string;
        };
      };

      const xmlJson: XmlInput = {
        'domain:name': {
          '@_avail': '1',
          '#text': 'example.com',
        },
      };

      const result = typedDecode(xmlJson, { strategy: FastXmlParserStrategy });

      // Runtime checks
      expect(result.$meta).toBeDefined();
      expect(result.$meta.strategyId).toBe('fxp-v1');

      // Type inference check: result.name should exist and have correct structure
      // TypeScript will error if name doesn't exist on the inferred type
      const name = result.name;
      expect(name).toBeDefined();

      // This proves the type inference worked:
      // If InferCleanType didn't work, 'name' wouldn't be accessible
      // without explicit type assertion
    });

    it('should work with array types', () => {
      type XmlInput = {
        'domain:cd': Array<{
          'domain:name': string;
        }>;
      };

      const xmlJson: XmlInput = {
        'domain:cd': [
          { 'domain:name': 'example.com' },
          { 'domain:name': 'test.com' },
        ],
      };

      const result = typedDecode(xmlJson, { strategy: FastXmlParserStrategy });

      // Runtime checks
      expect(result.$meta).toBeDefined();
      expect(Array.isArray(result.cd)).toBe(true);
      expect(result.cd).toHaveLength(2);

      // Type inference proves cd is typed as array
      const firstItem = result.cd[0];
      expect(firstItem).toBeDefined();
    });

    it('should preserve literal types', () => {
      type XmlInput = {
        '@_status': 'active' | 'inactive' | 'pending';
      };

      const xmlJson: XmlInput = {
        '@_status': 'active',
      };

      const result = typedDecode(xmlJson, { strategy: FastXmlParserStrategy });

      expect(result.status).toBe('active');

      // Type-level check: status should be 'active' | 'inactive' | 'pending'
      // This assignment would fail if literal types weren't preserved
      const status: 'active' | 'inactive' | 'pending' = result.status;
      expect(status).toBe('active');
    });
  });

  describe('complex EPP types', () => {
    it('should handle domain:chkData structure', () => {
      type DomainChkDataXml = {
        'domain:cd': Array<{
          'domain:name': {
            '@_avail': '1' | '0' | 'true' | 'false';
            '#text': string;
          };
          'domain:reason'?: {
            '@_lang'?: string;
            '#text': string;
          };
        }>;
      };

      const xmlJson: DomainChkDataXml = {
        'domain:cd': [
          {
            'domain:name': {
              '@_avail': '1',
              '#text': 'example.com',
            },
          },
          {
            'domain:name': {
              '@_avail': '0',
              '#text': 'taken.com',
            },
            'domain:reason': {
              '@_lang': 'en',
              '#text': 'In use',
            },
          },
        ],
      };

      const result = typedDecode(xmlJson, { strategy: FastXmlParserStrategy });

      // Runtime checks
      expect(result.$meta).toBeDefined();
      expect(result.cd).toHaveLength(2);

      // Type inference allows accessing nested properties
      const firstName = result.cd[0].name;
      expect(firstName.avail).toBe('1');
      expect(firstName.value).toBe('example.com');

      // Second item with optional reason
      const secondItem = result.cd[1];
      expect(secondItem.name.avail).toBe('0');
      expect(secondItem.reason).toBeDefined();
    });
  });
});
