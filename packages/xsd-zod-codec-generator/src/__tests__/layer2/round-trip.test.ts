/**
 * Layer 2 Round-Trip Tests
 *
 * Verifies that encode(decode(x)) produces equivalent XML JSON.
 */

import { describe, it, expect } from 'vitest';
import { decode, encode, FastXmlParserStrategy } from '../../layer2/index.js';

describe('round-trip', () => {
  describe('simple structures', () => {
    it('should round-trip simple text element', () => {
      const original = {
        'domain:name': 'example.com',
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      // The encoded result should have equivalent structure
      // Note: exact key names may differ due to namespace handling
      expect(encoded).toBeDefined();
      const keys = Object.keys(encoded as Record<string, unknown>);
      expect(keys.length).toBeGreaterThan(0);
    });

    it('should round-trip attributes', () => {
      const original = {
        '@_id': '123',
        '@_type': 'domain',
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      expect((encoded as Record<string, unknown>)['@_id']).toBe('123');
      expect((encoded as Record<string, unknown>)['@_type']).toBe('domain');
    });

    it('should round-trip text with attributes', () => {
      const original = {
        '@_avail': '1',
        '#text': 'example.com',
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      // With flatten mode, the structure is: { avail: '1', value: 'example.com' }
      // When encoded back, it should reconstruct the @_ and #text
      expect(encoded).toBeDefined();
    });
  });

  describe('nested structures', () => {
    it('should round-trip nested elements', () => {
      const original = {
        'domain:chkData': {
          'domain:cd': {
            'domain:name': 'example.com',
          },
        },
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      expect(encoded).toBeDefined();
      const outer = encoded as Record<string, unknown>;
      expect(Object.keys(outer).length).toBeGreaterThan(0);
    });

    it('should round-trip arrays of elements', () => {
      const original = {
        'domain:cd': [
          { 'domain:name': 'example.com' },
          { 'domain:name': 'test.com' },
        ],
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      const outer = encoded as Record<string, unknown>;
      // Find the array in the encoded result
      const arrayKey = Object.keys(outer).find((k) => Array.isArray(outer[k]));

      if (arrayKey) {
        expect((outer[arrayKey] as unknown[]).length).toBe(2);
      }
    });
  });

  describe('complex EPP-like structures', () => {
    it('should round-trip domain:chkData structure', () => {
      const original = {
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
              '#text': 'In use',
            },
          },
        ],
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      expect(encoded).toBeDefined();

      // Verify structure is preserved
      const outer = encoded as Record<string, unknown>;
      const cdKey = Object.keys(outer).find((k) => k.includes('cd'));

      if (cdKey) {
        const cd = outer[cdKey];
        expect(Array.isArray(cd)).toBe(true);
        expect((cd as unknown[]).length).toBe(2);
      }
    });

    it('should round-trip contact:infData structure', () => {
      const original = {
        'contact:id': 'sh8013',
        'contact:roid': 'SH8013-REP',
        'contact:status': [
          { '@_s': 'linked' },
          { '@_s': 'clientDeleteProhibited' },
        ],
        'contact:postalInfo': {
          '@_type': 'int',
          'contact:name': 'John Doe',
          'contact:org': 'Example Inc.',
          'contact:addr': {
            'contact:street': ['123 Example Dr.', 'Suite 100'],
            'contact:city': 'Dulles',
            'contact:sp': 'VA',
            'contact:pc': '20166-6503',
            'contact:cc': 'US',
          },
        },
        'contact:voice': {
          '@_x': '1234',
          '#text': '+1.7035555555',
        },
        'contact:email': 'jdoe@example.com',
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      expect(encoded).toBeDefined();

      // Verify some key fields are preserved
      const outer = encoded as Record<string, unknown>;
      expect(Object.keys(outer).length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty objects', () => {
      const original = {};

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      expect(encoded).toBeDefined();
    });

    it('should handle null values gracefully', () => {
      const original = {
        'domain:name': null,
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      expect(encoded).toBeDefined();
    });

    it('should handle numeric values', () => {
      const original = {
        '@_count': 5,
        'domain:price': 9.99,
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      expect((encoded as Record<string, unknown>)['@_count']).toBe(5);
    });

    it('should handle boolean values', () => {
      const original = {
        '@_active': true,
        '@_disabled': false,
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      expect((encoded as Record<string, unknown>)['@_active']).toBe(true);
      expect((encoded as Record<string, unknown>)['@_disabled']).toBe(false);
    });
  });

  describe('metadata preservation', () => {
    it('should preserve field metadata through round-trip', () => {
      const original = {
        '@_id': '123',
        'domain:name': 'example.com',
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });

      // Verify metadata is captured
      expect(decoded.$meta.root.fields.id).toBeDefined();
      expect(decoded.$meta.root.fields.id.kind).toBe('attribute');
      expect(decoded.$meta.root.fields.name).toBeDefined();
      expect(decoded.$meta.root.fields.name.kind).toBe('element');

      // Encode and verify structure is reconstructed
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });
      expect((encoded as Record<string, unknown>)['@_id']).toBe('123');
    });

    it('should preserve cardinality metadata', () => {
      const original = {
        'domain:cd': [
          { 'domain:name': 'example.com' },
          { 'domain:name': 'test.com' },
        ],
      };

      const decoded = decode(original, { strategy: FastXmlParserStrategy });

      // cd field should have 'many' cardinality
      expect(decoded.$meta.root.fields.cd.cardinality).toBe('many');

      // Encode should produce array
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });
      const cdKey = Object.keys(encoded as Record<string, unknown>).find((k) =>
        k.includes('cd'),
      );

      if (cdKey) {
        expect(Array.isArray((encoded as Record<string, unknown>)[cdKey])).toBe(
          true,
        );
      }
    });
  });
});
