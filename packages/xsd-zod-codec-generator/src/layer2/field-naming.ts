/**
 * Field Name Transformation Utilities
 *
 * Utilities for:
 * - Stripping namespace prefixes (domain:name → name)
 * - Applying fieldNameMapping overrides
 * - Conflict resolution when multiple namespaces have same local name
 * - Inferring namespace aliases from URIs
 */

/**
 * Context for field name resolution.
 * Tracks existing keys to detect conflicts.
 */
export interface FieldNameContext {
  /** Already used simplified keys (for conflict detection) */
  existingKeys: Set<string>;
  /** Field name mapping: {ns}localName or localName -> simplified name */
  mapping: Map<string, string>;
  /** Namespace URI -> alias prefix for disambiguation */
  namespaceAliases: Map<string, string>;
}

/**
 * Create a new field name context.
 */
export const createFieldNameContext = (
  fieldNameMapping?: Record<string, string>,
  namespaceAliases?: Map<string, string>,
): FieldNameContext => {
  return {
    existingKeys: new Set(),
    mapping: new Map(Object.entries(fieldNameMapping || {})),
    namespaceAliases: namespaceAliases || new Map(),
  };
};

/**
 * Clone a field name context (for nested processing).
 */
export const cloneFieldNameContext = (
  context: FieldNameContext,
  clearExistingKeys = false,
): FieldNameContext => ({
  existingKeys: clearExistingKeys ? new Set() : new Set(context.existingKeys),
  mapping: new Map(context.mapping),
  namespaceAliases: new Map(context.namespaceAliases),
});

/**
 * Extract local name from potentially prefixed name.
 *
 * @example
 * getLocalName("domain:name") // "name"
 * getLocalName("name") // "name"
 */
export const getLocalName = (prefixedName: string): string => {
  const colonIdx = prefixedName.indexOf(':');
  return colonIdx >= 0 ? prefixedName.slice(colonIdx + 1) : prefixedName;
};

/**
 * Extract namespace prefix from prefixed name.
 *
 * @example
 * getPrefix("domain:name") // "domain"
 * getPrefix("name") // undefined
 */
export const getPrefix = (prefixedName: string): string | undefined => {
  const colonIdx = prefixedName.indexOf(':');
  return colonIdx >= 0 ? prefixedName.slice(0, colonIdx) : undefined;
};

/**
 * Build mapping key for fieldNameMapping lookup.
 * Supports both formats: {namespace}localName and {namespace}:localName
 *
 * @example
 * buildMappingKey("avail", "urn:ietf:params:xml:ns:domain-1.0")
 * // "{urn:ietf:params:xml:ns:domain-1.0}avail"
 *
 * buildMappingKey("lang", undefined) // "lang"
 */
export const buildMappingKey = (
  localName: string,
  namespace: string | undefined,
): string => {
  return namespace ? `{${namespace}}${localName}` : localName;
};

/**
 * Parse a mapping key to extract namespace and local name.
 *
 * @example
 * parseMappingKey("{urn:example}name") // { namespace: "urn:example", localName: "name" }
 * parseMappingKey("name") // { namespace: undefined, localName: "name" }
 */
export const parseMappingKey = (
  key: string,
): { namespace: string | undefined; localName: string } => {
  if (key.startsWith('{')) {
    const endIdx = key.indexOf('}');
    if (endIdx > 0) {
      return {
        namespace: key.slice(1, endIdx),
        localName: key.slice(endIdx + 1),
      };
    }
  }
  return { namespace: undefined, localName: key };
};

/**
 * Compute simplified field name from XML name.
 *
 * Handles:
 * - Stripping namespace prefix (if stripPrefix is true)
 * - Applying fieldNameMapping
 * - Resolving conflicts between different namespaces
 *
 * @param xmlKey The original XML key (e.g., "domain:name" or "name")
 * @param namespace The namespace URI (if known)
 * @param context Field name context for conflict detection
 * @param stripPrefix Whether to strip namespace prefix
 * @returns The simplified field name
 */
export const computeSimplifiedName = (
  xmlKey: string,
  namespace: string | undefined,
  context: FieldNameContext,
  stripPrefix = true,
): string => {
  const localName = getLocalName(xmlKey);

  // 1. Check fieldNameMapping for prefixed key first (e.g., "domain:name" -> "domainName")
  const mappedByPrefixedKey = context.mapping.get(xmlKey);
  if (mappedByPrefixedKey) {
    context.existingKeys.add(mappedByPrefixedKey);
    return mappedByPrefixedKey;
  }

  // 2. Check fieldNameMapping for namespace-qualified key (e.g., "{uri}name" -> "domainName")
  const mappingKeyWithNs = buildMappingKey(localName, namespace);
  const mappedNameWithNs = context.mapping.get(mappingKeyWithNs);
  if (mappedNameWithNs) {
    context.existingKeys.add(mappedNameWithNs);
    return mappedNameWithNs;
  }

  // 3. Check fieldNameMapping for local name only (e.g., "name" -> "identifier")
  const mappedName = context.mapping.get(localName);
  if (mappedName) {
    context.existingKeys.add(mappedName);
    return mappedName;
  }

  // 4. Use stripped or original key as base name
  let simplified = stripPrefix ? localName : xmlKey;

  // 5. Check for conflicts with existing keys
  if (context.existingKeys.has(simplified)) {
    // On conflict, preserve the original prefixed key to maintain uniqueness
    simplified = xmlKey;

    // If still conflicting (unlikely), add a number suffix
    let counter = 2;
    const baseSimplified = simplified;
    while (context.existingKeys.has(simplified)) {
      simplified = `${baseSimplified}${counter}`;
      counter++;
    }
  }

  context.existingKeys.add(simplified);
  return simplified;
};

/**
 * Infer namespace alias from namespace URI.
 *
 * Uses known patterns for common namespaces, falls back to
 * extracting the last path segment.
 *
 * @example
 * inferNamespaceAlias("urn:ietf:params:xml:ns:domain-1.0") // "domain"
 * inferNamespaceAlias("urn:ietf:params:xml:ns:contact-1.0") // "contact"
 * inferNamespaceAlias("http://example.com/foo") // "foo"
 */
export const inferNamespaceAlias = (namespace: string): string => {
  // Common EPP namespaces
  if (namespace.includes('domain-1.0')) return 'domain';
  if (namespace.includes('contact-1.0')) return 'contact';
  if (namespace.includes('host-1.0')) return 'host';
  if (namespace.includes('epp-1.0') && !namespace.includes('eppcom'))
    return 'epp';
  if (namespace.includes('eppcom-1.0')) return 'eppcom';
  if (namespace.includes('secDNS') || namespace.includes('secdns'))
    return 'secDNS';
  if (namespace.includes('fee-')) return 'fee';
  if (namespace.includes('rgp-1.0')) return 'rgp';
  if (namespace.includes('launch-1.0')) return 'launch';

  // XML Schema namespace
  if (namespace === 'http://www.w3.org/2001/XMLSchema') return 'xs';

  // Extract last path segment
  const parts = namespace.split(/[/:]/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part && part !== '') {
      // Remove version suffix
      const cleaned = part.replace(/-[\d.]+$/, '').replace(/[^a-zA-Z0-9]/g, '');
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  }

  return 'ns';
};

/**
 * Build a qualified key from namespace and local name (for encoding back).
 *
 * @param localName The local name
 * @param namespace The namespace URI
 * @param prefixMap Map of namespace URI to prefix
 */
export const buildQualifiedKey = (
  localName: string,
  namespace: string | undefined,
  prefixMap: Map<string, string>,
): string => {
  if (!namespace) {
    return localName;
  }

  const prefix = prefixMap.get(namespace);
  return prefix ? `${prefix}:${localName}` : localName;
};

/**
 * Namespace to prefix mappings.
 * Empty by default - users should provide their own via namespaceAliases option.
 */
export const KNOWN_NAMESPACE_PREFIXES: Record<string, string> = {};

/**
 * Create a prefix map from known namespaces.
 * Returns a Map for faster lookups.
 */
export const createPrefixMap = (
  additionalMappings?: Record<string, string>,
): Map<string, string> => {
  const map = new Map(Object.entries(KNOWN_NAMESPACE_PREFIXES));
  if (additionalMappings) {
    for (const [ns, prefix] of Object.entries(additionalMappings)) {
      map.set(ns, prefix);
    }
  }
  return map;
};

/**
 * Infer prefix from namespace URI for encoding.
 * Checks configured prefixes, then falls back to URI-based inference.
 */
export const inferPrefixFromNamespace = (namespace: string): string => {
  const known = KNOWN_NAMESPACE_PREFIXES[namespace];
  if (known) return known;
  return inferNamespaceAlias(namespace);
};
