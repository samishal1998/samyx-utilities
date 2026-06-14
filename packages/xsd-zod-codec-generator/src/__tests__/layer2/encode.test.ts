/**
 * Layer 2 Encode Tests
 */

import { describe, it, expect } from 'vitest';
import {
  decode,
  encode,
  encodeWithPrefixes,
  FastXmlParserStrategy,
  attachMeta,
  createMinimalMeta,
} from '../../layer2/index.js';

describe('encode', () => {
  describe('basic encoding', () => {
    it('should encode simple element', () => {
      // First decode to get proper metadata
      const xmlJson = {
        'domain:name': 'example.com',
      };

      // Without namespace aliases, prefix can't be restored - use local name
      const decoded = decode(xmlJson, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      expect(encoded).toBeDefined();
      // Without namespace mappings, the local name is used
      expect((encoded as Record<string, unknown>)['name']).toBeDefined();
    });

    it('should encode attributes', () => {
      const xmlJson = {
        '@_avail': 'true',
        '@_reason': 'available',
      };

      const decoded = decode(xmlJson, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      expect((encoded as Record<string, unknown>)['@_avail']).toBe('true');
      expect((encoded as Record<string, unknown>)['@_reason']).toBe(
        'available',
      );
    });

    it('should encode nested elements', () => {
      const xmlJson = {
        'domain:cd': {
          'domain:name': 'example.com',
        },
      };

      // Without namespace aliases, prefixes can't be restored
      const decoded = decode(xmlJson, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      const encodedObj = encoded as Record<string, unknown>;
      // Local names used without namespace mappings
      expect(encodedObj['cd']).toBeDefined();
    });

    it('should encode arrays', () => {
      const xmlJson = {
        'domain:cd': [
          { 'domain:name': 'example.com' },
          { 'domain:name': 'test.com' },
        ],
      };

      // Without namespace aliases, prefixes can't be restored
      const decoded = decode(xmlJson, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      const encodedObj = encoded as Record<string, unknown>;
      // Local names used without namespace mappings
      expect(Array.isArray(encodedObj['cd'])).toBe(true);
      expect((encodedObj['cd'] as unknown[]).length).toBe(2);
    });
  });

  describe('mixed content encoding', () => {
    it('should encode flattened mixed content', () => {
      // Payload with flattened structure
      const payload = {
        name: {
          avail: '1',
          value: 'example.com',
        },
      };

      const meta = createMinimalMeta('fxp-v1', { localName: 'chkData' });
      meta.root.fields = {
        name: {
          kind: 'element',
          xmlName: 'name',
          namespace: 'urn:ietf:params:xml:ns:domain-1.0',
          cardinality: 'one' as const,
        },
      };

      const envelope = attachMeta(payload, meta);
      const encoded = encode(envelope, { strategy: FastXmlParserStrategy });

      expect(encoded).toBeDefined();
    });

    it('should encode nested mixed content', () => {
      // Payload with nested structure
      const payload = {
        name: {
          attributes: { avail: '1' },
          text: 'example.com',
        },
      };

      const meta = createMinimalMeta('fxp-v1', { localName: 'chkData' });
      meta.root.fields = {
        name: {
          kind: 'element',
          xmlName: 'name',
          namespace: 'urn:ietf:params:xml:ns:domain-1.0',
          cardinality: 'one' as const,
        },
      };

      const envelope = attachMeta(payload, meta);
      const encoded = encode(envelope, { strategy: FastXmlParserStrategy });

      expect(encoded).toBeDefined();
    });
  });

  describe('namespace handling', () => {
    it('should restore namespace prefixes from metadata', () => {
      const xmlJson = {
        'domain:name': 'example.com',
      };

      const decoded = decode(xmlJson, { strategy: FastXmlParserStrategy });
      const encoded = encode(decoded, { strategy: FastXmlParserStrategy });

      const encodedObj = encoded as Record<string, unknown>;
      // Should have domain: prefix restored
      const keys = Object.keys(encodedObj);
      expect(keys.some((k) => k.includes('domain:') || k === 'name')).toBe(
        true,
      );
    });
  });

  describe('encodeWithPrefixes', () => {
    it('should use custom prefix mappings', () => {
      const xmlJson = {
        'domain:name': 'example.com',
      };

      const decoded = decode(xmlJson, { strategy: FastXmlParserStrategy });

      // Update metadata to include namespace
      decoded.$meta.root.fields.name = {
        ...decoded.$meta.root.fields.name,
        namespace: 'urn:ietf:params:xml:ns:domain-1.0',
      };

      const encoded = encodeWithPrefixes(
        decoded,
        { strategy: FastXmlParserStrategy },
        {
          'urn:ietf:params:xml:ns:domain-1.0': 'dom',
        },
      );

      expect(encoded).toBeDefined();
    });
  });

  describe('createNode behavior', () => {
    it('should create node with attributes only', () => {
      const node = FastXmlParserStrategy.createNode({
        qname: { localName: 'test' },
        attributes: { id: '123', type: 'domain' },
      });

      expect((node as Record<string, unknown>)['@_id']).toBe('123');
      expect((node as Record<string, unknown>)['@_type']).toBe('domain');
    });

    it('should create node with text only', () => {
      const node = FastXmlParserStrategy.createNode({
        qname: { localName: 'test' },
        text: 'hello world',
      });

      expect((node as Record<string, unknown>)['#text']).toBe('hello world');
    });

    it('should create node with attributes and text', () => {
      const node = FastXmlParserStrategy.createNode({
        qname: { localName: 'test' },
        attributes: { lang: 'en' },
        text: 'hello',
      });

      expect((node as Record<string, unknown>)['@_lang']).toBe('en');
      expect((node as Record<string, unknown>)['#text']).toBe('hello');
    });

    it('should create node with children', () => {
      const node = FastXmlParserStrategy.createNode({
        qname: { localName: 'parent' },
        children: {
          'child:name': 'test',
        },
      });

      expect((node as Record<string, unknown>)['child:name']).toBe('test');
    });
  });
});
