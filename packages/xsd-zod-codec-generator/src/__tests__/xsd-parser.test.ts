import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseXsdContent,
  extractDirectives,
  extractTargetNamespace,
} from '../loader/xsd-parser.js';

const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures');

describe('XSD Parser', () => {
  describe('parseXsdContent', () => {
    it('parses simple XSD and extracts target namespace', async () => {
      const content = await readFile(
        resolve(FIXTURES_DIR, 'simple.xsd'),
        'utf-8',
      );
      const result = parseXsdContent(content, 'simple.xsd');

      expect(result.targetNamespace).toBe('urn:test:simple');
    });

    it('extracts simple types with enumerations', async () => {
      const content = await readFile(
        resolve(FIXTURES_DIR, 'simple.xsd'),
        'utf-8',
      );
      const result = parseXsdContent(content, 'simple.xsd');

      const statusType = result.simpleTypes.find(
        (t) => t.name.localName === 'statusType',
      );
      expect(statusType).toBeDefined();
      expect(statusType?.enumeration).toEqual([
        'active',
        'inactive',
        'pending',
      ]);
    });

    it('extracts simple types with patterns', async () => {
      const content = await readFile(
        resolve(FIXTURES_DIR, 'simple.xsd'),
        'utf-8',
      );
      const result = parseXsdContent(content, 'simple.xsd');

      const codeType = result.simpleTypes.find(
        (t) => t.name.localName === 'codeType',
      );
      expect(codeType).toBeDefined();
      expect(codeType?.pattern).toBe('[A-Z]{2,3}');
      expect(codeType?.minLength).toBe(2);
      expect(codeType?.maxLength).toBe(3);
    });

    it('extracts complex types with sequences', async () => {
      const content = await readFile(
        resolve(FIXTURES_DIR, 'simple.xsd'),
        'utf-8',
      );
      const result = parseXsdContent(content, 'simple.xsd');

      const personType = result.complexTypes.find(
        (t) => t.name.localName === 'personType',
      );
      expect(personType).toBeDefined();
      expect(personType?.contentModel?.kind).toBe('group');
      expect((personType?.contentModel as any)?.compositor).toBe('sequence');
    });

    it('extracts complex types with attributes', async () => {
      const content = await readFile(
        resolve(FIXTURES_DIR, 'simple.xsd'),
        'utf-8',
      );
      const result = parseXsdContent(content, 'simple.xsd');

      const personType = result.complexTypes.find(
        (t) => t.name.localName === 'personType',
      );
      expect(personType).toBeDefined();
      expect(personType?.attributes).toHaveLength(1);
      expect(personType?.attributes[0]?.name.localName).toBe('id');
      expect(personType?.attributes[0]?.use).toBe('required');
    });

    it('extracts global elements', async () => {
      const content = await readFile(
        resolve(FIXTURES_DIR, 'simple.xsd'),
        'utf-8',
      );
      const result = parseXsdContent(content, 'simple.xsd');

      expect(result.elements.length).toBeGreaterThanOrEqual(3);

      const greeting = result.elements.find(
        (e) => e.name.localName === 'greeting',
      );
      expect(greeting).toBeDefined();

      const person = result.elements.find((e) => e.name.localName === 'person');
      expect(person).toBeDefined();

      const people = result.elements.find((e) => e.name.localName === 'people');
      expect(people).toBeDefined();
    });

    it('handles inline complex types on elements', async () => {
      const content = await readFile(
        resolve(FIXTURES_DIR, 'simple.xsd'),
        'utf-8',
      );
      const result = parseXsdContent(content, 'simple.xsd');

      const greeting = result.elements.find(
        (e) => e.name.localName === 'greeting',
      );
      expect(greeting).toBeDefined();
      expect(greeting?.type).toBeDefined();
      expect((greeting?.type as any)?.attributes).toBeDefined();
    });
  });

  describe('extractTargetNamespace', () => {
    it('extracts target namespace from XSD', async () => {
      const content = await readFile(
        resolve(FIXTURES_DIR, 'simple.xsd'),
        'utf-8',
      );
      const ns = extractTargetNamespace(content);

      expect(ns).toBe('urn:test:simple');
    });

    it('returns undefined for XSD without target namespace', () => {
      const content = `<?xml version="1.0"?>
        <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
          <xs:element name="test" type="xs:string"/>
        </xs:schema>`;

      const ns = extractTargetNamespace(content);
      expect(ns).toBeUndefined();
    });
  });

  describe('extractDirectives', () => {
    it('extracts import directives', () => {
      const content = `<?xml version="1.0"?>
        <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
                   targetNamespace="urn:test:main">
          <xs:import namespace="urn:test:other" schemaLocation="other.xsd"/>
          <xs:import namespace="urn:test:another" schemaLocation="another.xsd"/>
        </xs:schema>`;

      const directives = extractDirectives(content);
      expect(directives).toHaveLength(2);
      expect(directives[0]?.type).toBe('import');
      expect(directives[0]?.namespace).toBe('urn:test:other');
      expect(directives[0]?.schemaLocation).toBe('other.xsd');
    });

    it('extracts include directives', () => {
      const content = `<?xml version="1.0"?>
        <xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
                   targetNamespace="urn:test:main">
          <xs:include schemaLocation="types.xsd"/>
        </xs:schema>`;

      const directives = extractDirectives(content);
      expect(directives).toHaveLength(1);
      expect(directives[0]?.type).toBe('include');
      expect(directives[0]?.schemaLocation).toBe('types.xsd');
    });
  });
});
