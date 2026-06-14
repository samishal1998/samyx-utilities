/**
 * Decode Function
 *
 * Transforms XML JSON (from fast-xml-parser) into clean TypeScript objects
 * with metadata ($meta) enabling round-trip encoding.
 */

import type {
  Layer2Envelope,
  XmlMeta,
  XmlNodeMeta,
  XmlFieldMeta,
  XmlJsonStrategy,
} from './types.js';
import type { DecodeOptions, MixedContentMode } from './options.js';
import { DEFAULT_DECODE_OPTIONS } from './options.js';
import {
  detectMetadata,
  createPrefixToNamespaceMap,
} from './detect-metadata.js';
import {
  getLocalName,
  getPrefix,
  computeSimplifiedName,
  createFieldNameContext,
  cloneFieldNameContext,
  type FieldNameContext,
} from './field-naming.js';

/**
 * Decode a Layer-1 XML JSON node into a simplified object + $meta.
 *
 * - Applies fieldNameMapping (e.g., "avail" -> "availability")
 * - Handles namespaces and conflicts
 * - Strips namespace prefixes by default
 * - Handles mixed content based on mixedContentMode
 *
 * @param xmlNode The XML JSON node to decode (from fast-xml-parser)
 * @param options Decode options including strategy and mappings
 * @returns Layer2Envelope with simplified payload and $meta
 */
export const decode = <TPayload extends object = Record<string, unknown>>(
  xmlNode: unknown,
  options: DecodeOptions,
): Layer2Envelope<TPayload> => {
  const mergedOptions = { ...DEFAULT_DECODE_OPTIONS, ...options };
  const { strategy, stripNamespacePrefixes = true } = mergedOptions;
  const mixedContentMode = mergedOptions.mixedContentMode ?? 'flatten';
  const textValueKey = mergedOptions.textValueKey ?? 'value';

  // Detect metadata structure
  const nodeMeta = detectMetadata(xmlNode, {
    strategy,
    schemaGraph: mergedOptions.schemaGraph,
    stripNamespacePrefixes,
    fieldNameMapping: mergedOptions.fieldNameMapping,
    namespaceAliases: mergedOptions.namespaceAliases,
    mixedContentMode,
    textValueKey,
  });

  // Build field name context
  const context = createFieldNameContext(
    mergedOptions.fieldNameMapping,
    mergedOptions.namespaceAliases,
  );

  // Create reversed map for prefix → namespace lookup (same as detectMetadata)
  const prefixToNamespace = createPrefixToNamespaceMap(
    mergedOptions.namespaceAliases,
  );

  // Build simplified payload
  const payload = buildPayload(
    xmlNode,
    nodeMeta,
    strategy,
    context,
    stripNamespacePrefixes,
    mixedContentMode,
    textValueKey,
    prefixToNamespace,
  );

  const meta: XmlMeta = {
    strategyId: strategy.id,
    root: nodeMeta,
  };

  return { ...payload, $meta: meta } as Layer2Envelope<TPayload>;
};

/**
 * Build simplified payload from XML JSON node.
 */
const buildPayload = (
  xmlNode: unknown,
  nodeMeta: XmlNodeMeta,
  strategy: XmlJsonStrategy,
  context: FieldNameContext,
  stripNamespacePrefixes: boolean,
  mixedContentMode: MixedContentMode,
  textValueKey: string,
  prefixToNamespace: Map<string, string>,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};

  // 1. Extract attributes
  const attributes = strategy.getAttributes(xmlNode);
  for (const [attrName, value] of Object.entries(attributes)) {
    const simplifiedName = computeSimplifiedName(
      attrName,
      undefined,
      context,
      stripNamespacePrefixes,
    );
    payload[simplifiedName] = value;
  }

  // 2. Extract children
  const children = strategy.getChildren(xmlNode);

  // Pre-scan to detect conflicting local names (same logic as detectMetadata)
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

    // Infer namespace from prefix (same logic as detectMetadata)
    const childNamespace = prefix
      ? prefixToNamespace.get(prefix) || undefined
      : undefined;

    // Compute the simplified name using the same logic as detectMetadata
    // This ensures we look up the field using the same key that was used to store it
    const simplifiedName = computeSimplifiedName(
      childKey,
      childNamespace,
      context,
      shouldStripPrefix,
    );

    // Find matching field metadata by simplified name
    const fieldMeta = nodeMeta.fields[simplifiedName];

    if (fieldMeta && fieldMeta.kind === 'element') {
      if (fieldMeta.nodeMeta) {
        // Complex nested element - recurse
        if (Array.isArray(childValue)) {
          payload[simplifiedName] = childValue.map((child) =>
            buildPayload(
              child,
              fieldMeta.nodeMeta!,
              strategy,
              cloneFieldNameContext(context, true),
              stripNamespacePrefixes,
              mixedContentMode,
              textValueKey,
              prefixToNamespace,
            ),
          );
        } else {
          payload[simplifiedName] = buildPayload(
            childValue,
            fieldMeta.nodeMeta,
            strategy,
            cloneFieldNameContext(context, true),
            stripNamespacePrefixes,
            mixedContentMode,
            textValueKey,
            prefixToNamespace,
          );
        }
      } else {
        // Simple element - extract value
        if (Array.isArray(childValue)) {
          payload[simplifiedName] = childValue.map((child) =>
            extractSimpleValue(child, strategy, mixedContentMode, textValueKey),
          );
        } else {
          payload[simplifiedName] = extractSimpleValue(
            childValue,
            strategy,
            mixedContentMode,
            textValueKey,
          );
        }
      }
    } else {
      // No field metadata found - still process the child with default behavior
      // This handles optional fields that weren't in the first array sample
      // Use the simplifiedName already computed above (with correct namespace)

      if (Array.isArray(childValue)) {
        payload[simplifiedName] = childValue.map((child) =>
          processUnknownChild(
            child,
            strategy,
            context,
            stripNamespacePrefixes,
            mixedContentMode,
            textValueKey,
            prefixToNamespace,
          ),
        );
      } else {
        payload[simplifiedName] = processUnknownChild(
          childValue,
          strategy,
          context,
          stripNamespacePrefixes,
          mixedContentMode,
          textValueKey,
          prefixToNamespace,
        );
      }
    }
  }

  // 3. Handle text content for the current node
  const text = strategy.getText(xmlNode);
  if (text !== undefined && nodeMeta.value) {
    payload[textValueKey] = text;
  }

  return payload;
};

/**
 * Process a child element that wasn't detected in metadata.
 * This handles optional fields that weren't present in the first array sample.
 */
const processUnknownChild = (
  child: unknown,
  strategy: XmlJsonStrategy,
  context: FieldNameContext,
  stripNamespacePrefixes: boolean,
  mixedContentMode: MixedContentMode,
  textValueKey: string,
  prefixToNamespace: Map<string, string>,
): unknown => {
  // If child is primitive, return directly
  if (child === null || child === undefined) return child;
  if (typeof child !== 'object') return child;

  // Check if it has nested child elements (complex) or just attributes + text (simple)
  const children = strategy.getChildren(child);
  const hasNestedChildren = Object.keys(children).length > 0;

  if (hasNestedChildren) {
    // Complex element - build payload recursively
    // Create a minimal node meta for this unknown node
    const nodeMeta = detectMetadata(child, {
      strategy,
      stripNamespacePrefixes,
    });

    return buildPayload(
      child,
      nodeMeta,
      strategy,
      cloneFieldNameContext(context, true),
      stripNamespacePrefixes,
      mixedContentMode,
      textValueKey,
      prefixToNamespace,
    );
  }
  // Simple element - extract value
  return extractSimpleValue(child, strategy, mixedContentMode, textValueKey);
};

/**
 * Extract value from a simple element.
 * Handles elements that may have attributes + text content.
 */
const extractSimpleValue = (
  child: unknown,
  strategy: XmlJsonStrategy,
  mixedContentMode: MixedContentMode,
  textValueKey: string,
): unknown => {
  // If child is primitive, return directly
  if (child === null || child === undefined) return child;
  if (typeof child !== 'object') return child;

  // Get attributes and text
  const attrs = strategy.getAttributes(child);
  const text = strategy.getText(child);
  const children = strategy.getChildren(child);

  // If has children, it's not truly simple - just return the node
  if (Object.keys(children).length > 0) {
    return child;
  }

  // If no attributes, just return text (or undefined if no text)
  if (Object.keys(attrs).length === 0) {
    return text;
  }

  // Has both attributes and text - apply mixedContentMode
  if (mixedContentMode === 'flatten') {
    // Flatten: merge attributes with text as 'value' key
    const result: Record<string, unknown> = { ...attrs };
    if (text !== undefined) {
      result[textValueKey] = text;
    }
    return result;
  }
  // Nested: { attributes: {...}, text: ... }
  return {
    attributes: attrs,
    text,
  };
};

/**
 * Find field metadata by original key (e.g., "domain:name") or local name.
 * Returns the metadata and its simplified name (the key in fields).
 */
const findFieldMeta = (
  nodeMeta: XmlNodeMeta,
  originalKey: string,
  localName: string,
): { meta: XmlFieldMeta; simplifiedName: string } | undefined => {
  const prefix = getPrefix(originalKey);

  // First, try to find by matching both xmlName and namespace prefix
  for (const [key, meta] of Object.entries(nodeMeta.fields)) {
    if (meta.xmlName === localName) {
      // Check if namespace matches the prefix (if we have namespace info)
      if (meta.kind === 'element' && meta.namespace && prefix) {
        // Extract prefix from namespace for comparison
        // namespaceAliases maps URI -> prefix, so we need to check if meta.namespace
        // corresponds to the prefix we extracted from the original key
        // For now, just match by the key pattern
        const expectedPattern = `${prefix}_${localName}`;
        if (
          key === localName ||
          key === expectedPattern ||
          key.endsWith(`_${localName}`)
        ) {
          // Return the first match that seems to correspond to this prefix
          if (key.startsWith(prefix) || key === localName) {
            return { meta, simplifiedName: key };
          }
        }
      }
    }
  }

  // Fallback: find first match by xmlName
  for (const [key, meta] of Object.entries(nodeMeta.fields)) {
    if (meta.xmlName === localName) {
      return { meta, simplifiedName: key };
    }
  }

  // Also try matching by key directly
  const direct = nodeMeta.fields[localName];
  if (direct) {
    return { meta: direct, simplifiedName: localName };
  }

  return undefined;
};

/**
 * Typed decode that infers the output type from the input XML JSON type.
 *
 * Use this when you have a known XML JSON type (e.g., from Layer 1 Zod schemas)
 * and want automatic type inference for the clean output.
 *
 * @example
 * ```typescript
 * import { typedDecode, FastXmlParserStrategy } from './layer2';
 * import type { DomainChkDataXml } from '../generated/epp-core';
 *
 * const xmlJson: DomainChkDataXml = { ... };
 * const result = typedDecode(xmlJson, { strategy: FastXmlParserStrategy });
 * // result.cd[0].name.avail is typed!
 * ```
 */
export const typedDecode = <TInput extends object>(
  xmlNode: TInput,
  options: DecodeOptions,
): import('./type-inference.js').InferCleanEnvelope<TInput> => {
  return decode(
    xmlNode,
    options,
  ) as import('./type-inference.js').InferCleanEnvelope<TInput>;
};

/**
 * Decode with a known element QName (for better metadata).
 * This is useful when you know the root element's identity.
 */
export const decodeWithQName = <
  TPayload extends object = Record<string, unknown>,
>(
  xmlNode: unknown,
  qname: { namespace?: string; localName: string },
  options: DecodeOptions,
): Layer2Envelope<TPayload> => {
  // Create options with known QName
  const detectOptions = {
    ...options,
    knownQName: qname,
    parentNamespace: qname.namespace,
  };

  const mergedOptions = { ...DEFAULT_DECODE_OPTIONS, ...options };
  const { strategy, stripNamespacePrefixes = true } = mergedOptions;
  const mixedContentMode = mergedOptions.mixedContentMode ?? 'flatten';
  const textValueKey = mergedOptions.textValueKey ?? 'value';

  // Detect metadata with known QName
  const nodeMeta = detectMetadata(xmlNode, detectOptions);

  // Build field name context
  const context = createFieldNameContext(
    mergedOptions.fieldNameMapping,
    mergedOptions.namespaceAliases,
  );

  // Create reversed map for prefix → namespace lookup
  const prefixToNamespace = createPrefixToNamespaceMap(
    mergedOptions.namespaceAliases,
  );

  // Build simplified payload
  const payload = buildPayload(
    xmlNode,
    nodeMeta,
    strategy,
    context,
    stripNamespacePrefixes,
    mixedContentMode,
    textValueKey,
    prefixToNamespace,
  );

  const meta: XmlMeta = {
    strategyId: strategy.id,
    root: nodeMeta,
  };

  return { ...payload, $meta: meta } as Layer2Envelope<TPayload>;
};
