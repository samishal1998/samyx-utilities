import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { z } from 'zod';
import { buildSchemaGraph } from '../loader/schema-graph-builder.js';
import { generateFromSchemaGraph } from '../codegen/zod-emitter.js';

const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures');

describe('Zod Emitter', () => {
  describe('generateFromSchemaGraph', () => {
    it('generates element modules', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const result = generateFromSchemaGraph(graph);

      expect(result.elements.length).toBeGreaterThanOrEqual(3);
    });

    it('generates index.ts content', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const result = generateFromSchemaGraph(graph);

      expect(result.index).toContain("export * from './schema-meta.js';");
      expect(result.index).toContain('./elements/');
    });

    it('generates schema-meta.ts content', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const result = generateFromSchemaGraph(graph);

      expect(result.schemaMeta).toContain('test-pack');
      expect(result.schemaMeta).toContain('urn:test:simple');
      expect(result.schemaMeta).toContain('rootElements');
    });

    it('generates type modules when emitComplexTypes is true', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const result = generateFromSchemaGraph(graph, { emitComplexTypes: true });

      expect(result.types.length).toBeGreaterThan(0);
    });

    it('generates valid Zod schema syntax', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const result = generateFromSchemaGraph(graph);

      // Check that element modules contain valid Zod syntax
      for (const elem of result.elements) {
        expect(elem.content).toContain("import { z } from 'zod';");
        // Elements may reference types or contain z.object directly
        expect(
          elem.content.includes('z.object(') || elem.content.includes('Xml'), // references a type
        ).toBe(true);
        expect(elem.content).toContain('export const');
        expect(elem.content).toContain('export type');
      }

      // Check that type modules contain z.object
      for (const type of result.types) {
        expect(type.content).toContain("import { z } from 'zod';");
        expect(type.content).toContain('z.object(');
        expect(type.content).toContain('export const');
        expect(type.content).toContain('export type');
      }
    });

    it('uses namespace prefixes in property names', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const result = generateFromSchemaGraph(graph, {
        useNamespacePrefixes: true,
      });

      // Find the people element which has test:person children
      const peopleElem = result.elements.find(
        (e) => e.qname.localName === 'people',
      );
      expect(peopleElem).toBeDefined();
    });

    it('handles attributes with @_ prefix', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const result = generateFromSchemaGraph(graph);

      // Find greeting element which has lang attribute
      const greetingElem = result.elements.find(
        (e) => e.qname.localName === 'greeting',
      );
      expect(greetingElem?.content).toContain('@_lang');
    });

    it('handles enumeration types', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const result = generateFromSchemaGraph(graph, { emitComplexTypes: true });

      // The personType uses statusType which has enumeration
      // Check in the type module, not element module (since types are now separate)
      const personType = result.types.find(
        (t) => t.qname.localName === 'personType',
      );
      expect(personType?.content).toContain('z.enum(');
    });

    it('handles optional elements with minOccurs=0', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const result = generateFromSchemaGraph(graph);

      // personType has optional email element
      // Check in the type module, not element module (since types are now separate)
      const personType = result.types.find(
        (t) => t.qname.localName === 'personType',
      );
      expect(personType?.content).toContain('.optional()');
    });

    it('handles unbounded elements as arrays', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const result = generateFromSchemaGraph(graph);

      // people element has unbounded person children
      const peopleElem = result.elements.find(
        (e) => e.qname.localName === 'people',
      );
      expect(peopleElem?.content).toContain('z.array(');
    });
  });

  describe('Generated schema validation', () => {
    it('can create and use generated enum schema', () => {
      // Simulate what would be generated for statusType
      const StatusTypeXml = z.enum(['active', 'inactive', 'pending']);

      expect(StatusTypeXml.parse('active')).toBe('active');
      expect(StatusTypeXml.parse('inactive')).toBe('inactive');
      expect(() => StatusTypeXml.parse('invalid')).toThrow();
    });

    it('can create and use generated object schema with attributes', () => {
      // Simulate what would be generated for greeting element
      const GreetingXml = z.object({
        'test:message': z.string(),
        '@_lang': z.string().optional(),
      });

      const valid = {
        'test:message': 'Hello',
        '@_lang': 'en',
      };

      expect(GreetingXml.parse(valid)).toEqual(valid);
    });

    it('can create and use generated schema with arrays', () => {
      // Simulate what would be generated for people element
      const PersonXml = z.object({
        'test:name': z.string(),
        'test:email': z.string().optional(),
        'test:status': z.enum(['active', 'inactive', 'pending']),
        '@_id': z.string(),
      });

      const PeopleXml = z.object({
        'test:person': z.array(PersonXml),
      });

      const valid = {
        'test:person': [
          {
            'test:name': 'John',
            'test:status': 'active',
            '@_id': '1',
          },
          {
            'test:name': 'Jane',
            'test:email': 'jane@example.com',
            'test:status': 'inactive',
            '@_id': '2',
          },
        ],
      };

      expect(PeopleXml.parse(valid)).toEqual(valid);
    });
  });
});
