/**
 * Layer 2 Decode Tests
 */

import { describe, it, expect } from 'vitest';
import {
  decode,
  decodeWithQName,
  FastXmlParserStrategy,
  type InferCleanType,
  isLayer2Envelope,
} from '../../layer2/index.js';

describe('decode', () => {
  describe('basic decoding', () => {
    it('should decode simple element with text content', () => {
      const xmlJson = {
        'domain:name': 'example.com',
      };

      const result = decode(xmlJson, { strategy: FastXmlParserStrategy });

      expect(isLayer2Envelope(result)).toBe(true);
      expect(result.name).toBe('example.com');
      expect(result.$meta.strategyId).toBe('fxp-v1');
    });

    it('should decode element with attributes', () => {
      const xmlJson = {
        '@_avail': 'true',
        '@_reason': 'available',
      };

      const result = decode(xmlJson, { strategy: FastXmlParserStrategy });

      expect(result.avail).toBe('true');
      expect(result.reason).toBe('available');
    });

    it('should decode element with mixed content (attributes + text)', () => {
      const xmlJson = {
        'domain:name': {
          '@_avail': '1',
          '#text': 'example.com',
        },
      };

      const result = decode(xmlJson, { strategy: FastXmlParserStrategy });

      // With flatten mode (default), the nested structure should be flattened
      expect(result.name).toEqual({
        avail: '1',
        value: 'example.com',
      });
    });

    it('should decode nested elements', () => {
      const xmlJson = {
        'domain:cd': {
          'domain:name': {
            '@_avail': '1',
            '#text': 'example.com',
          },
        },
      };

      const result = decode(xmlJson, { strategy: FastXmlParserStrategy });

      expect(result.cd).toBeDefined();
      expect((result.cd as Record<string, unknown>).name).toBeDefined();
    });

    it('should decode arrays', () => {
      const xmlJson = {
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
          },
        ],
      };

      const result: InferCleanType<typeof xmlJson> = decode(xmlJson, {
        strategy: FastXmlParserStrategy,
      });

      expect(Array.isArray(result.cd)).toBe(true);
      expect((result.cd as unknown[]).length).toBe(2);
    });
  });

  describe('namespace prefix stripping', () => {
    it('should strip namespace prefixes by default', () => {
      const xmlJson = {
        'domain:name': 'example.com',
        'contact:id': 'contact123',
      };

      const result = decode(xmlJson, { strategy: FastXmlParserStrategy });

      expect(result.name).toBe('example.com');
      expect(result.id).toBe('contact123');
    });

    it('should keep namespace prefixes when stripNamespacePrefixes is false', () => {
      const xmlJson = {
        'domain:name': 'example.com',
      };

      const result = decode(xmlJson, {
        strategy: FastXmlParserStrategy,
        stripNamespacePrefixes: false,
      });

      expect(result['domain:name']).toBe('example.com');
    });
  });

  describe('field name mapping', () => {
    it('should apply field name mapping', () => {
      const xmlJson = {
        '@_avail': '1',
      };

      const result = decode(xmlJson, {
        strategy: FastXmlParserStrategy,
        fieldNameMapping: {
          avail: 'availability',
        },
      });

      expect(result.availability).toBe('1');
      expect(result.avail).toBeUndefined();
    });

    it('should apply field name mapping to namespaced elements', () => {
      // Namespace-qualified field mapping requires knowing the full namespace URI
      // For runtime use without SchemaGraph, use simple local name mapping instead
      const xmlJson = {
        'domain:name': 'example.com',
        'contact:name': 'John Doe',
        test: 'value',
      };

      // Case 1: Using namespaceAliases with namespace-qualified keys
      const result = decode(xmlJson, {
        strategy: FastXmlParserStrategy,
        fieldNameMapping: {
          '{ns:domain-1.0}name': 'domainName',
          '{ns:contact-1.0}name': 'contactName',
        },
        namespaceAliases: new Map([
          ['ns:domain-1.0', 'domain'],
          ['ns:contact-1.0', 'contact'],
        ]),
      });

      // Case 2: Using prefixed keys directly (no namespaceAliases needed)
      const result2 = decode(xmlJson, {
        strategy: FastXmlParserStrategy,
        fieldNameMapping: {
          'domain:name': 'domainName',
          'contact:name': 'contactName',
        },
      });

      // Case 3
      const result3 = decode(xmlJson, {
        strategy: FastXmlParserStrategy,
      });

      expect(result.domainName).toBe('example.com');
      expect(result.contactName).toBe('John Doe');

      expect(result2.domainName).toBe('example.com');
      expect(result2.contactName).toBe('John Doe');

      expect(result3['domain:name']).toBe('example.com');
      expect(result3['contact:name']).toBe('John Doe');
    });
  });

  describe('mixed content modes', () => {
    it('should flatten mixed content by default', () => {
      const xmlJson = {
        'domain:name': {
          '@_avail': '1',
          '#text': 'example.com',
        },
      };

      const result = decode(xmlJson, {
        strategy: FastXmlParserStrategy,
        mixedContentMode: 'flatten',
      });

      const name = result.name as Record<string, unknown>;
      expect(name.avail).toBe('1');
      expect(name.value).toBe('example.com');
    });

    it('should nest mixed content when mode is nested', () => {
      const xmlJson = {
        'domain:name': {
          '@_avail': '1',
          '#text': 'example.com',
        },
      };

      const result = decode(xmlJson, {
        strategy: FastXmlParserStrategy,
        mixedContentMode: 'nested',
      });

      const name = result.name as Record<string, unknown>;
      expect(name.attributes).toEqual({ avail: '1' });
      expect(name.text).toBe('example.com');
    });

    it('should use custom text value key', () => {
      const xmlJson = {
        'domain:name': {
          '@_avail': '1',
          '#text': 'example.com',
        },
      };

      const result = decode(xmlJson, {
        strategy: FastXmlParserStrategy,
        mixedContentMode: 'flatten',
        textValueKey: 'text',
      });

      const name = result.name as Record<string, unknown>;
      expect(name.text).toBe('example.com');
    });
  });

  describe('metadata', () => {
    it('should include $meta with strategy id', () => {
      const xmlJson = {
        'domain:name': 'example.com',
      };

      const result = decode(xmlJson, { strategy: FastXmlParserStrategy });

      expect(result.$meta).toBeDefined();
      expect(result.$meta.strategyId).toBe('fxp-v1');
    });

    it('should include root node metadata', () => {
      const xmlJson = {
        'domain:name': 'example.com',
      };

      const result = decode(xmlJson, { strategy: FastXmlParserStrategy });

      expect(result.$meta.root).toBeDefined();
      expect(result.$meta.root.fields).toBeDefined();
    });

    it('should track field metadata correctly', () => {
      const xmlJson = {
        '@_id': '123',
        'domain:name': 'example.com',
      };

      const result = decode(xmlJson, { strategy: FastXmlParserStrategy });

      const idField = result.$meta.root.fields.id;
      expect(idField).toBeDefined();
      expect(idField.kind).toBe('attribute');
      expect(idField.xmlName).toBe('id');

      const nameField = result.$meta.root.fields.name;
      expect(nameField).toBeDefined();
      expect(nameField.kind).toBe('element');
      expect(nameField.xmlName).toBe('name');
    });
  });

  describe('decodeWithQName', () => {
    it('should decode with known QName', () => {
      const xmlJson = {
        'domain:cd': [
          {
            'domain:name': {
              '@_avail': '1',
              '#text': 'example.com',
            },
          },
        ],
      };

      const result = decodeWithQName(
        xmlJson,
        {
          namespace: 'urn:ietf:params:xml:ns:domain-1.0',
          localName: 'chkData',
        },
        { strategy: FastXmlParserStrategy },
      );

      expect(result.$meta.root.qname.localName).toBe('chkData');
      expect(result.$meta.root.qname.namespace).toBe(
        'urn:ietf:params:xml:ns:domain-1.0',
      );
    });
  });
});
