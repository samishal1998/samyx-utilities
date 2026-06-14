/**
 * Meta Utilities
 *
 * Helper functions for manipulating Layer2Envelope metadata.
 */

import type {
  Layer2Envelope,
  XmlMeta,
  XmlNodeMeta,
  XmlFieldMeta,
} from './types.js';

/**
 * Extract metadata from a Layer2Envelope.
 *
 * Useful when you want to:
 * - Clone or modify the payload
 * - Keep $meta separate and re-attach later
 */
export const extractMeta = (envelope: Layer2Envelope<object>): XmlMeta => {
  return envelope.$meta;
};

/**
 * Extract payload from a Layer2Envelope (without $meta).
 */
export const extractPayload = <T extends object>(
  envelope: Layer2Envelope<T>,
): T => {
  const { $meta: _, ...payload } = envelope;
  return payload as T;
};

/**
 * Attach metadata to a payload object.
 *
 * This does NOT validate; caller is responsible for ensuring consistency.
 */
export const attachMeta = <TPayload extends object>(
  payload: TPayload,
  meta: XmlMeta,
): Layer2Envelope<TPayload> => {
  return { ...payload, $meta: meta };
};

/**
 * Clone envelope with transformed payload, preserving metadata.
 */
export const cloneWithMeta = <T extends object>(
  envelope: Layer2Envelope<T>,
  transform: (payload: T) => T,
): Layer2Envelope<T> => {
  const { $meta, ...payload } = envelope;
  const newPayload = transform(payload as T);
  return { ...newPayload, $meta };
};

/**
 * Map over envelope payload while preserving metadata.
 */
export const mapEnvelope = <T extends object, U extends object>(
  envelope: Layer2Envelope<T>,
  mapper: (payload: T) => U,
): Layer2Envelope<U> => {
  const { $meta, ...payload } = envelope;
  const newPayload = mapper(payload as T);
  return { ...newPayload, $meta };
};

/**
 * Check if an object is a Layer2Envelope.
 */
export const isLayer2Envelope = (
  obj: unknown,
): obj is Layer2Envelope<object> => {
  if (obj === null || typeof obj !== 'object') return false;
  if (!('$meta' in obj)) return false;

  const meta = (obj as { $meta: unknown }).$meta;
  if (meta === null || typeof meta !== 'object') return false;

  return 'strategyId' in meta && 'root' in meta;
};

/**
 * Merge two envelopes, combining their payloads.
 * Uses the metadata from the first envelope.
 */
export const mergeEnvelopes = <T extends object, U extends object>(
  first: Layer2Envelope<T>,
  second: Layer2Envelope<U>,
): Layer2Envelope<T & U> => {
  const { $meta: meta1, ...payload1 } = first;
  const { $meta: _meta2, ...payload2 } = second;
  return {
    ...payload1,
    ...payload2,
    $meta: meta1,
  } as Layer2Envelope<T & U>;
};

/**
 * Create a minimal XmlMeta for a given strategy and QName.
 */
export const createMinimalMeta = (
  strategyId: string,
  qname: { namespace?: string; localName: string },
): XmlMeta => ({
  strategyId,
  root: {
    qname,
    fields: {},
  },
});

/**
 * Deep clone XmlMeta.
 */
export const cloneMeta = (meta: XmlMeta): XmlMeta => ({
  strategyId: meta.strategyId,
  root: cloneNodeMeta(meta.root),
});

/**
 * Deep clone XmlNodeMeta.
 */
export const cloneNodeMeta = (nodeMeta: XmlNodeMeta): XmlNodeMeta => ({
  qname: { ...nodeMeta.qname },
  value: nodeMeta.value ? { ...nodeMeta.value } : undefined,
  fields: Object.fromEntries(
    Object.entries(nodeMeta.fields).map(([key, field]) => [
      key,
      cloneFieldMeta(field),
    ]),
  ),
});

/**
 * Deep clone XmlFieldMeta.
 */
export const cloneFieldMeta = (fieldMeta: XmlFieldMeta): XmlFieldMeta => {
  const clone = { ...fieldMeta };
  if (fieldMeta.kind === 'element' && fieldMeta.nodeMeta) {
    (clone as { nodeMeta?: XmlNodeMeta }).nodeMeta = cloneNodeMeta(
      fieldMeta.nodeMeta,
    );
  }
  return clone;
};

/**
 * Get all field names (simplified keys) from metadata.
 */
export const getFieldNames = (nodeMeta: XmlNodeMeta): string[] => {
  return Object.keys(nodeMeta.fields);
};

/**
 * Get all attribute fields from metadata.
 */
export const getAttributeFields = (
  nodeMeta: XmlNodeMeta,
): [string, XmlFieldMeta][] => {
  return Object.entries(nodeMeta.fields).filter(
    ([_, meta]) => meta.kind === 'attribute',
  );
};

/**
 * Get all element fields from metadata.
 */
export const getElementFields = (
  nodeMeta: XmlNodeMeta,
): [string, XmlFieldMeta][] => {
  return Object.entries(nodeMeta.fields).filter(
    ([_, meta]) => meta.kind === 'element',
  );
};

/**
 * Find field metadata by simplified key.
 */
export const findFieldByKey = (
  nodeMeta: XmlNodeMeta,
  simplifiedKey: string,
): XmlFieldMeta | undefined => {
  return nodeMeta.fields[simplifiedKey];
};

/**
 * Find field metadata by XML name.
 */
export const findFieldByXmlName = (
  nodeMeta: XmlNodeMeta,
  xmlName: string,
): [string, XmlFieldMeta] | undefined => {
  for (const [key, meta] of Object.entries(nodeMeta.fields)) {
    if (meta.xmlName === xmlName) {
      return [key, meta];
    }
  }
  return undefined;
};

/**
 * Check if metadata has any attributes.
 */
export const hasAttributes = (nodeMeta: XmlNodeMeta): boolean => {
  return Object.values(nodeMeta.fields).some((f) => f.kind === 'attribute');
};

/**
 * Check if metadata has any elements.
 */
export const hasElements = (nodeMeta: XmlNodeMeta): boolean => {
  return Object.values(nodeMeta.fields).some((f) => f.kind === 'element');
};

/**
 * Check if metadata has value (text content).
 */
export const hasValue = (nodeMeta: XmlNodeMeta): boolean => {
  return nodeMeta.value !== undefined;
};
