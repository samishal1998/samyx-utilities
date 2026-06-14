/**
 * FastXmlParser Strategy
 *
 * Default strategy for fast-xml-parser JSON format.
 *
 * Conventions:
 * - Attributes: "@_" prefix (e.g., "@_avail", "@_lang")
 * - Text content: "#text" key
 * - Children: direct properties with optional namespace prefix (e.g., "domain:name")
 */

import type { XmlJsonStrategy, QName } from '../types.js';

/**
 * Default strategy for fast-xml-parser JSON format.
 *
 * @example
 * Input XML: <domain:name avail="true">example.com</domain:name>
 *
 * fast-xml-parser JSON:
 * {
 *   "domain:name": {
 *     "@_avail": "true",
 *     "#text": "example.com"
 *   }
 * }
 */
export const FastXmlParserStrategy: XmlJsonStrategy = {
  id: 'fxp-v1',

  getAttributes(node: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!node || typeof node !== 'object') return out;

    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (key.startsWith('@_')) {
        const attrName = key.slice(2);
        out[attrName] = value;
      }
    }
    return out;
  },

  getChildren(node: unknown): Record<string, unknown | unknown[]> {
    const out: Record<string, unknown | unknown[]> = {};
    if (!node || typeof node !== 'object') return out;

    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      // Skip attributes and text content
      if (key.startsWith('@_') || key === '#text') continue;
      out[key] = value;
    }
    return out;
  },

  getText(node: unknown): unknown {
    if (!node || typeof node !== 'object') {
      // If node is a primitive (string, number, boolean), return it directly
      if (
        typeof node === 'string' ||
        typeof node === 'number' ||
        typeof node === 'boolean'
      ) {
        return node;
      }
      return undefined;
    }
    return (node as Record<string, unknown>)['#text'];
  },

  createNode(input: {
    qname: QName;
    attributes?: Record<string, unknown>;
    text?: unknown;
    children?: Record<string, unknown | unknown[]>;
  }): unknown {
    const { attributes, text, children } = input;
    const node: Record<string, unknown> = {};

    // Add attributes with @_ prefix
    if (attributes) {
      for (const [attrName, value] of Object.entries(attributes)) {
        if (value !== undefined) {
          node[`@_${attrName}`] = value;
        }
      }
    }

    // Add text content
    if (text !== undefined) {
      node['#text'] = text;
    }

    // Add children
    if (children) {
      for (const [key, value] of Object.entries(children)) {
        if (value !== undefined) {
          node[key] = value;
        }
      }
    }

    return node;
  },
};

/**
 * Check if a node has any attributes (for fast-xml-parser format)
 */
export const hasAttributes = (node: unknown): boolean => {
  if (!node || typeof node !== 'object') return false;
  return Object.keys(node as Record<string, unknown>).some((key) =>
    key.startsWith('@_'),
  );
};

/**
 * Check if a node has text content (for fast-xml-parser format)
 */
export const hasTextContent = (node: unknown): boolean => {
  if (!node || typeof node !== 'object') return false;
  return '#text' in (node as Record<string, unknown>);
};

/**
 * Check if a node is a "simple" node (only has text, no children)
 */
export const isSimpleNode = (node: unknown): boolean => {
  if (!node || typeof node !== 'object') return true;
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Only has attributes and/or text
  return keys.every((key) => key.startsWith('@_') || key === '#text');
};
