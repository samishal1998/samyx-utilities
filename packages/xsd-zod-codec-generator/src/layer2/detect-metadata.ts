/**
 * Metadata Detection
 *
 * Build metadata for XML JSON nodes by introspecting their structure.
 * This is the runtime metadata detection that doesn't require SchemaGraph.
 */

import type {
  XmlJsonStrategy,
  XmlNodeMeta,
  XmlFieldMeta,
  XmlAttributeFieldMeta,
  XmlElementFieldMeta,
  XmlValueMeta,
  QName,
} from './types.js';
import type { DetectMetadataOptions } from './options.js';
import { DEFAULT_DETECT_OPTIONS } from './options.js';
import {
  getLocalName,
  getPrefix,
  computeSimplifiedName,
  createFieldNameContext,
  cloneFieldNameContext,
  inferNamespaceAlias,
  type FieldNameContext,
} from './field-naming.js';

/**
 * Infer namespace URI from prefix.
 * Checks prefixToNamespace map first, then falls back to parent namespace.
 */
const inferNamespaceFromPrefix = (
  prefix: string,
  prefixToNamespace: Map<string, string>,
  parentNamespace?: string,
): string | undefined => {
  return prefixToNamespace.get(prefix) || parentNamespace;
};

/**
 * Create a reversed map from namespaceAliases (URI → prefix) to (prefix → URI).
 */
export const createPrefixToNamespaceMap = (
  namespaceAliases?: Map<string, string>,
): Map<string, string> => {
  const reversed = new Map<string, string>();
  if (namespaceAliases) {
    for (const [uri, prefix] of namespaceAliases) {
      reversed.set(prefix, uri);
    }
  }
  return reversed;
};

/**
 * Build metadata for a given XML JSON node.
 *
 * Inspects:
 *  - attributes via strategy.getAttributes()
 *  - children via strategy.getChildren()
 *  - text via strategy.getText()
 *
 * Does NOT yet rename fields to simplified names; use decode() for that.
 */
export const detectMetadata = (
  xmlNode: unknown,
  options: DetectMetadataOptions,
): XmlNodeMeta => {
  const mergedOptions = { ...DEFAULT_DETECT_OPTIONS, ...options };
  const { strategy, parentNamespace, knownQName } = mergedOptions;

  // Create field name context
  const context = createFieldNameContext(
    mergedOptions.fieldNameMapping,
    mergedOptions.namespaceAliases,
  );

  // Create reversed map for prefix → namespace lookup
  const prefixToNamespace = createPrefixToNamespaceMap(
    mergedOptions.namespaceAliases,
  );

  return detectNodeMetadata(
    xmlNode,
    strategy,
    parentNamespace,
    knownQName,
    context,
    mergedOptions.stripNamespacePrefixes ?? true,
    prefixToNamespace,
  );
};

/**
 * Internal: Detect metadata for a single node.
 */
const detectNodeMetadata = (
  xmlNode: unknown,
  strategy: XmlJsonStrategy,
  parentNamespace: string | undefined,
  knownQName: QName | undefined,
  context: FieldNameContext,
  stripNamespacePrefixes: boolean,
  prefixToNamespace: Map<string, string>,
): XmlNodeMeta => {
  // Determine QName
  const qname: QName = knownQName || {
    namespace: parentNamespace,
    localName: 'unknown',
  };

  const fields: Record<string, XmlFieldMeta> = {};

  // 1. Process attributes
  const attributes = strategy.getAttributes(xmlNode);
  for (const [attrName, _value] of Object.entries(attributes)) {
    // Attributes typically don't have namespace prefixes
    const simplifiedName = computeSimplifiedName(
      attrName,
      undefined,
      context,
      stripNamespacePrefixes,
    );

    const attrMeta: XmlAttributeFieldMeta = {
      kind: 'attribute',
      xmlName: attrName,
      namespace: undefined, // Attributes rarely have namespaces in EPP
      cardinality: 'one',
    };

    fields[simplifiedName] = attrMeta;
  }

  // 2. Process children
  const children = strategy.getChildren(xmlNode);

  // Pre-scan to detect conflicting local names (same localName, different prefixes)
  const localNameCount = new Map<string, number>();
  for (const childKey of Object.keys(children)) {
    const localName = getLocalName(childKey);
    localNameCount.set(localName, (localNameCount.get(localName) || 0) + 1);
  }
  const conflictingLocalNames = new Set(
    [...localNameCount.entries()]
      .filter(([_, count]) => count > 1)
      .map(([name]) => name),
  );

  for (const [childKey, childValue] of Object.entries(children)) {
    const localName = getLocalName(childKey);
    const prefix = getPrefix(childKey);

    // If this local name conflicts with another, don't strip prefix
    const shouldStripPrefix =
      stripNamespacePrefixes && !conflictingLocalNames.has(localName);

    // Infer namespace from prefix or parent
    const childNamespace = prefix
      ? inferNamespaceFromPrefix(prefix, prefixToNamespace, parentNamespace)
      : parentNamespace;

    // Detect cardinality from whether value is array
    const cardinality = Array.isArray(childValue) ? 'many' : 'one';

    // Get simplified name
    const simplifiedName = computeSimplifiedName(
      childKey,
      childNamespace,
      context,
      shouldStripPrefix,
    );

    // Check if child is complex (has nested child elements, not just attributes + text)
    const sampleChild = Array.isArray(childValue) ? childValue[0] : childValue;
    const isComplex =
      sampleChild !== null &&
      typeof sampleChild === 'object' &&
      !isPrimitive(sampleChild) &&
      hasChildElements(sampleChild, strategy);

    const elementMeta: XmlElementFieldMeta = {
      kind: 'element',
      xmlName: localName,
      namespace: childNamespace,
      cardinality,
    };

    // Recursively build nodeMeta for complex children
    if (isComplex) {
      // Create a fresh context for nested object
      const nestedContext = cloneFieldNameContext(context, true);

      elementMeta.nodeMeta = detectNodeMetadata(
        sampleChild,
        strategy,
        childNamespace,
        { namespace: childNamespace, localName },
        nestedContext,
        stripNamespacePrefixes,
        prefixToNamespace,
      );
    }

    fields[simplifiedName] = elementMeta;
  }

  // 3. Check for text content
  const text = strategy.getText(xmlNode);
  let valueMeta: XmlValueMeta | undefined;

  if (text !== undefined) {
    valueMeta = {
      kind: 'value',
      xmlName: '#text',
      cardinality: 'one',
    };
  }

  return {
    qname,
    value: valueMeta,
    fields,
  };
};

/**
 * Check if a value is a primitive (not requiring nested metadata).
 */
const isPrimitive = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean';
};

/**
 * Check if a node has actual child elements (not just attributes + text).
 * A node with only @_ attributes and #text is considered "simple".
 */
const hasChildElements = (
  node: unknown,
  strategy: XmlJsonStrategy,
): boolean => {
  if (!node || typeof node !== 'object') return false;
  const children = strategy.getChildren(node);
  return Object.keys(children).length > 0;
};

/**
 * Get the text value key name based on options.
 */
export const getTextValueKey = (options: DetectMetadataOptions): string => {
  return options.textValueKey ?? 'value';
};
