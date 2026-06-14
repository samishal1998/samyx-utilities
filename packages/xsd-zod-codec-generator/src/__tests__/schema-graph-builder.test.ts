import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  buildSchemaGraph,
  getElements,
  getComplexTypes,
  getSimpleTypes,
} from '../loader/schema-graph-builder.js';
import { qNameKey } from '../xml-schema-graph-ir.js';

const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures');

describe('SchemaGraph Builder', () => {
  describe('buildSchemaGraph', () => {
    it('builds schema graph from single XSD file', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      expect(graph.name).toBe('test-pack');
      expect(graph.namespaces).toContain('urn:test:simple');
    });

    it('indexes all elements by QName', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const greetingKey = qNameKey({
        namespace: 'urn:test:simple',
        localName: 'greeting',
      });
      const personKey = qNameKey({
        namespace: 'urn:test:simple',
        localName: 'person',
      });
      const peopleKey = qNameKey({
        namespace: 'urn:test:simple',
        localName: 'people',
      });

      expect(graph.elements.has(greetingKey)).toBe(true);
      expect(graph.elements.has(personKey)).toBe(true);
      expect(graph.elements.has(peopleKey)).toBe(true);
    });

    it('indexes all complex types by QName', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const personTypeKey = qNameKey({
        namespace: 'urn:test:simple',
        localName: 'personType',
      });
      const contactTypeKey = qNameKey({
        namespace: 'urn:test:simple',
        localName: 'contactType',
      });

      expect(graph.complexTypes.has(personTypeKey)).toBe(true);
      expect(graph.complexTypes.has(contactTypeKey)).toBe(true);
    });

    it('indexes all simple types by QName', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const statusTypeKey = qNameKey({
        namespace: 'urn:test:simple',
        localName: 'statusType',
      });
      const codeTypeKey = qNameKey({
        namespace: 'urn:test:simple',
        localName: 'codeType',
      });

      expect(graph.simpleTypes.has(statusTypeKey)).toBe(true);
      expect(graph.simpleTypes.has(codeTypeKey)).toBe(true);
    });

    it('filters by rootNamespaces when specified', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
        rootNamespaces: ['urn:other:namespace'],
      });

      // Should filter out all elements since none match
      expect(graph.elements.size).toBe(0);
    });
  });

  describe('getElements', () => {
    it('returns all elements when no namespace filter', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const elements = getElements(graph);
      expect(elements.length).toBeGreaterThanOrEqual(3);
    });

    it('filters elements by namespace', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const elements = getElements(graph, 'urn:test:simple');
      expect(elements.length).toBeGreaterThanOrEqual(3);

      const noElements = getElements(graph, 'urn:other:namespace');
      expect(noElements.length).toBe(0);
    });
  });

  describe('getComplexTypes', () => {
    it('returns all complex types when no namespace filter', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const types = getComplexTypes(graph);
      expect(types.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getSimpleTypes', () => {
    it('returns all simple types when no namespace filter', async () => {
      const graph = await buildSchemaGraph({
        name: 'test-pack',
        files: [resolve(FIXTURES_DIR, 'simple.xsd')],
      });

      const types = getSimpleTypes(graph);
      expect(types.length).toBeGreaterThanOrEqual(2);
    });
  });
});
