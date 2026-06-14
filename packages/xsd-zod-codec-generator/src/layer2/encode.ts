/**
 * Encode Function
 *
 * Transforms simplified TypeScript objects with $meta back into XML JSON
 * format (for fast-xml-parser).
 */

import type {
  Layer2Envelope,
  XmlNodeMeta,
  XmlFieldMeta,
  XmlJsonStrategy,
  XmlElementFieldMeta,
} from './types.js';
import type { EncodeOptions } from './options.js';
import { createPrefixMap, inferPrefixFromNamespace } from './field-naming.js';

/**
 * Encode a simplified object + metadata back into an XML JSON node.
 *
 * - Reads XmlMeta for field mappings
 * - Restores namespace prefixes from metadata
 * - Reconstructs @_ attributes and #text content
 * - Uses strategy's createNode() for output format
 *
 * @param envelope The Layer2Envelope to encode
 * @param options Encode options including strategy
 * @returns XML JSON node suitable for fast-xml-parser's XMLBuilder
 */
export const encode = (
  envelope: Layer2Envelope<Record<string, unknown>>,
  options: EncodeOptions,
): unknown => {
  const { $meta, ...payload } = envelope;
  const { strategy } = options;

  // Create prefix map for namespace -> prefix lookups
  const prefixMap = createPrefixMap();

  return buildXmlNode(payload, $meta.root, strategy, prefixMap);
};

/**
 * Build XML JSON node from simplified payload and metadata.
 */
const buildXmlNode = (
  payload: Record<string, unknown>,
  nodeMeta: XmlNodeMeta,
  strategy: XmlJsonStrategy,
  prefixMap: Map<string, string>,
): unknown => {
  const attributes: Record<string, unknown> = {};
  const children: Record<string, unknown | unknown[]> = {};
  let text: unknown;

  // Iterate over fields in metadata
  for (const [simplifiedKey, fieldMeta] of Object.entries(nodeMeta.fields)) {
    const value = payload[simplifiedKey];
    if (value === undefined) continue;

    if (fieldMeta.kind === 'attribute') {
      // Restore attribute
      attributes[fieldMeta.xmlName] = value;
    } else if (fieldMeta.kind === 'element') {
      // Build qualified key with namespace prefix
      const qualifiedKey = buildQualifiedKeyFromMeta(fieldMeta, prefixMap);

      const elementMeta = fieldMeta as XmlElementFieldMeta;

      if (elementMeta.nodeMeta) {
        // Complex nested element - recurse
        if (Array.isArray(value)) {
          children[qualifiedKey] = value.map((item) =>
            buildXmlNode(
              item as Record<string, unknown>,
              elementMeta.nodeMeta!,
              strategy,
              prefixMap,
            ),
          );
        } else if (typeof value === 'object' && value !== null) {
          children[qualifiedKey] = buildXmlNode(
            value as Record<string, unknown>,
            elementMeta.nodeMeta,
            strategy,
            prefixMap,
          );
        }
      } else {
        // Simple element - wrap value
        if (Array.isArray(value)) {
          children[qualifiedKey] = value.map((item) =>
            wrapSimpleValue(item, fieldMeta, strategy, prefixMap),
          );
        } else {
          children[qualifiedKey] = wrapSimpleValue(
            value,
            fieldMeta,
            strategy,
            prefixMap,
          );
        }
      }
    }
  }

  // Handle node's own text value
  if (nodeMeta.value && payload['value'] !== undefined) {
    text = payload['value'];
  }

  return strategy.createNode({
    qname: nodeMeta.qname,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    text,
    children: Object.keys(children).length > 0 ? children : undefined,
  });
};

/**
 * Build qualified key (with namespace prefix) from field metadata.
 */
const buildQualifiedKeyFromMeta = (
  fieldMeta: XmlFieldMeta,
  prefixMap: Map<string, string>,
): string => {
  if (fieldMeta.namespace) {
    // Try to get prefix from map
    let prefix = prefixMap.get(fieldMeta.namespace);

    // If not in map, infer from namespace URI
    if (!prefix) {
      prefix = inferPrefixFromNamespace(fieldMeta.namespace);
    }

    return prefix ? `${prefix}:${fieldMeta.xmlName}` : fieldMeta.xmlName;
  }
  return fieldMeta.xmlName;
};

/**
 * Wrap a simple value in an XML JSON node.
 * Handles both primitive values and objects with attributes.
 */
const wrapSimpleValue = (
  value: unknown,
  _fieldMeta: XmlFieldMeta,
  strategy: XmlJsonStrategy,
  _prefixMap: Map<string, string>,
): unknown => {
  // If value is an object with 'value' or 'text' key, it might have attributes
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Check for nested structure (from 'nested' mixedContentMode)
    if ('attributes' in obj && ('text' in obj || !('text' in obj))) {
      const attributes = obj['attributes'] as Record<string, unknown>;
      const text = obj['text'];
      return strategy.createNode({
        qname: { localName: '' },
        attributes,
        text,
      });
    }

    // Check for flattened structure (from 'flatten' mixedContentMode)
    // Look for a 'value' key alongside other keys (attributes)
    const keys = Object.keys(obj);
    if (keys.includes('value')) {
      const text = obj['value'];
      const attributes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k !== 'value') {
          attributes[k] = v;
        }
      }
      return strategy.createNode({
        qname: { localName: '' },
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        text,
      });
    }

    // Unknown structure - return as-is
    return value;
  }

  // Primitive value - wrap with text content only
  return strategy.createNode({
    qname: { localName: '' },
    text: value,
  });
};

/**
 * Encode with custom prefix mappings.
 * Use this when you need to control the namespace prefixes in output.
 */
export const encodeWithPrefixes = (
  envelope: Layer2Envelope<Record<string, unknown>>,
  options: EncodeOptions,
  customPrefixes: Record<string, string>,
): unknown => {
  const { $meta, ...payload } = envelope;
  const { strategy } = options;

  // Create prefix map with custom overrides
  const prefixMap = createPrefixMap(customPrefixes);

  return buildXmlNode(payload, $meta.root, strategy, prefixMap);
};
