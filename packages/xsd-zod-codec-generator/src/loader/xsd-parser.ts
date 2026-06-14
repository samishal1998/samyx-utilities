/**
 * XSD Parser - Parses XSD files into RawSchemaIR
 *
 * This module uses fast-xml-parser to parse XSD files and extract
 * type definitions, element declarations, and other schema components.
 */

import { XMLParser } from 'fast-xml-parser';
import type {
  AttributeIR,
  AttributeUse,
  ComplexTypeIR,
  ElementDeclIR,
  ElementParticleIR,
  ModelCompositor,
  ModelGroupParticleIR,
  NamespaceURI,
  Occurs,
  ParticleIR,
  QName,
  RawSchemaIR,
  SimpleTypeIR,
  SimpleTypeKind,
  AnyParticleIR,
} from '../xml-schema-graph-ir.js';

// XSD namespace constant
const XS_NS = 'http://www.w3.org/2001/XMLSchema';

// Type alias for parsed XML nodes
type XmlNode = Record<string, unknown>;

// Helper to get XSD element by name (handles xs:, xsd:, or unprefixed)
const getXsdElement = (node: XmlNode, localName: string): unknown => {
  return node[`xs:${localName}`] || node[`xsd:${localName}`] || node[localName];
};

// Elements that can appear multiple times
const ARRAY_ELEMENTS = [
  'element',
  'attribute',
  'simpleType',
  'complexType',
  'sequence',
  'choice',
  'all',
  'enumeration',
  'restriction',
  'extension',
  'import',
  'include',
  'redefine',
  'any',
  'group',
  'attributeGroup',
];

// Parser options for fast-xml-parser
const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  preserveOrder: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name: string) => {
    // Handle xs:, xsd:, or unprefixed elements
    const localName = name.includes(':') ? name.split(':')[1] : name;
    return ARRAY_ELEMENTS.includes(localName);
  },
};

// Create parser instance
const xmlParser = new XMLParser(parserOptions);

/**
 * Parse XSD content string into RawSchemaIR
 */
export const parseXsdContent = (
  content: string,
  filePath: string,
): RawSchemaIR => {
  const doc = xmlParser.parse(content) as XmlNode;
  // Support xs:schema, xsd:schema, or schema (default namespace)
  const schema = (doc['xs:schema'] || doc['xsd:schema'] || doc['schema']) as
    | XmlNode
    | undefined;

  if (!schema) {
    throw new Error(`No schema root element found in ${filePath}`);
  }

  const targetNamespace = schema['@_targetNamespace'] as
    | NamespaceURI
    | undefined;
  const nsMap = extractNamespaceMap(schema);

  // Create reversed map: URI -> prefix (for meta generation)
  const namespacePrefixes = new Map<string, string>();
  for (const [prefix, uri] of nsMap) {
    // Skip empty prefix and xs namespace (schema namespace, not useful for user elements)
    if (prefix && prefix !== 'xs' && prefix !== 'xsd' && uri !== XS_NS) {
      namespacePrefixes.set(uri, prefix);
    }
  }

  return {
    targetNamespace,
    namespacePrefixes,
    simpleTypes: parseSimpleTypes(schema, targetNamespace, nsMap),
    complexTypes: parseComplexTypes(schema, targetNamespace, nsMap),
    elements: parseElements(schema, targetNamespace, nsMap),
  };
};

/**
 * Extract namespace prefix → URI mapping from schema attributes
 */
const extractNamespaceMap = (schema: XmlNode): Map<string, NamespaceURI> => {
  const nsMap = new Map<string, NamespaceURI>();

  for (const [key, value] of Object.entries(schema)) {
    if (key.startsWith('@_xmlns:')) {
      const prefix = key.substring('@_xmlns:'.length);
      nsMap.set(prefix, value as string);
    } else if (key === '@_xmlns') {
      nsMap.set('', value as string);
    }
  }

  // Always include xs namespace
  if (!nsMap.has('xs')) {
    nsMap.set('xs', XS_NS);
  }

  return nsMap;
};

/**
 * XSD built-in type names that should resolve to XS_NS namespace
 */
const XSD_BUILTIN_TYPES = new Set([
  'string',
  'normalizedString',
  'token',
  'language',
  'NMTOKEN',
  'NMTOKENS',
  'Name',
  'NCName',
  'ID',
  'IDREF',
  'IDREFS',
  'ENTITY',
  'ENTITIES',
  'QName',
  'anyURI',
  'base64Binary',
  'hexBinary',
  'boolean',
  'decimal',
  'float',
  'double',
  'integer',
  'nonPositiveInteger',
  'negativeInteger',
  'long',
  'int',
  'short',
  'byte',
  'nonNegativeInteger',
  'unsignedLong',
  'unsignedInt',
  'unsignedShort',
  'unsignedByte',
  'positiveInteger',
  'dateTime',
  'date',
  'time',
  'duration',
  'gYear',
  'gYearMonth',
  'gMonth',
  'gMonthDay',
  'gDay',
  'anyType',
  'anySimpleType',
]);

/**
 * Resolve a prefixed name to a QName
 */
const resolveQName = (
  prefixedName: string,
  nsMap: Map<string, NamespaceURI>,
  defaultNs?: NamespaceURI,
): QName => {
  const colonIdx = prefixedName.indexOf(':');

  if (colonIdx === -1) {
    // For unprefixed names, check if it's an XSD built-in type
    // XSD built-in types should always resolve to XS_NS namespace
    if (XSD_BUILTIN_TYPES.has(prefixedName)) {
      return {
        namespace: XS_NS,
        localName: prefixedName,
      };
    }
    return {
      namespace: defaultNs || '',
      localName: prefixedName,
    };
  }

  const prefix = prefixedName.substring(0, colonIdx);
  const localName = prefixedName.substring(colonIdx + 1);
  const namespace = nsMap.get(prefix) || '';

  return { namespace, localName };
};

/**
 * Parse occurrence attributes (minOccurs, maxOccurs)
 */
const parseOccurs = (node: XmlNode): Occurs => {
  const minStr = node['@_minOccurs'] as string | undefined;
  const maxStr = node['@_maxOccurs'] as string | undefined;

  return {
    min: minStr !== undefined ? Number.parseInt(minStr, 10) : 1,
    max:
      maxStr === 'unbounded'
        ? Number.POSITIVE_INFINITY
        : maxStr !== undefined
          ? Number.parseInt(maxStr, 10)
          : 1,
  };
};

/**
 * Map XSD built-in types to SimpleTypeKind
 */
const xsdTypeToKind = (typeName: string): SimpleTypeKind => {
  const kindMap: Record<string, SimpleTypeKind> = {
    string: 'string',
    normalizedString: 'string',
    token: 'string',
    language: 'string',
    NMTOKEN: 'string',
    NMTOKENS: 'string',
    Name: 'string',
    NCName: 'string',
    ID: 'string',
    IDREF: 'string',
    IDREFS: 'string',
    ENTITY: 'string',
    ENTITIES: 'string',
    QName: 'string',
    anyURI: 'string',
    base64Binary: 'string',
    hexBinary: 'string',
    boolean: 'boolean',
    decimal: 'decimal',
    float: 'decimal',
    double: 'decimal',
    integer: 'integer',
    nonPositiveInteger: 'integer',
    negativeInteger: 'integer',
    long: 'integer',
    int: 'integer',
    short: 'integer',
    byte: 'integer',
    nonNegativeInteger: 'integer',
    unsignedLong: 'integer',
    unsignedInt: 'integer',
    unsignedShort: 'integer',
    unsignedByte: 'integer',
    positiveInteger: 'integer',
    dateTime: 'dateTime',
    date: 'date',
    time: 'time',
    duration: 'string',
    gYear: 'string',
    gYearMonth: 'string',
    gMonth: 'string',
    gMonthDay: 'string',
    gDay: 'string',
  };

  return kindMap[typeName] || 'anySimpleType';
};

/**
 * Parse xs:simpleType elements
 */
const parseSimpleTypes = (
  schema: XmlNode,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
): SimpleTypeIR[] => {
  const simpleTypes: SimpleTypeIR[] = [];
  const rawTypes = ensureArray<XmlNode>(getXsdElement(schema, 'simpleType'));

  for (const st of rawTypes) {
    const parsed = parseSimpleType(st, targetNamespace, nsMap);
    if (parsed) {
      simpleTypes.push(parsed);
    }
  }

  return simpleTypes;
};

/**
 * Parse a single xs:simpleType
 */
const parseSimpleType = (
  node: XmlNode,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
  syntheticName?: string,
): SimpleTypeIR | null => {
  const name = (node['@_name'] as string) || syntheticName || '__anonymous__';
  const qname: QName = { namespace: targetNamespace || '', localName: name };

  const restriction = getFirst<XmlNode>(getXsdElement(node, 'restriction'));
  const union = getXsdElement(node, 'union');
  const list = getXsdElement(node, 'list');

  let base: QName | undefined;
  let kind: SimpleTypeKind = 'string';
  let enumeration: string[] | undefined;
  let pattern: string | undefined;
  let minLength: number | undefined;
  let maxLength: number | undefined;
  let minInclusive: string | undefined;
  let maxInclusive: string | undefined;

  if (restriction) {
    const baseAttr = restriction['@_base'] as string | undefined;
    if (baseAttr) {
      base = resolveQName(baseAttr, nsMap, targetNamespace);
      kind = xsdTypeToKind(base.localName);
    }

    // Parse facets
    const enums = ensureArray<XmlNode>(
      getXsdElement(restriction, 'enumeration'),
    );
    if (enums.length > 0) {
      enumeration = enums.map((e) => e['@_value'] as string);
    }

    const patternNode = getFirst<XmlNode>(
      getXsdElement(restriction, 'pattern'),
    );
    if (patternNode) {
      pattern = patternNode['@_value'] as string;
    }

    const minLenNode = getFirst<XmlNode>(
      getXsdElement(restriction, 'minLength'),
    );
    if (minLenNode) {
      minLength = Number.parseInt(minLenNode['@_value'] as string, 10);
    }

    const maxLenNode = getFirst<XmlNode>(
      getXsdElement(restriction, 'maxLength'),
    );
    if (maxLenNode) {
      maxLength = Number.parseInt(maxLenNode['@_value'] as string, 10);
    }

    const minIncNode = getFirst<XmlNode>(
      getXsdElement(restriction, 'minInclusive'),
    );
    if (minIncNode) {
      minInclusive = minIncNode['@_value'] as string;
    }

    const maxIncNode = getFirst<XmlNode>(
      getXsdElement(restriction, 'maxInclusive'),
    );
    if (maxIncNode) {
      maxInclusive = maxIncNode['@_value'] as string;
    }
  } else if (union) {
    // Union types - treat as string for now
    kind = 'string';
  } else if (list) {
    // List types - treat as string for now
    kind = 'string';
  }

  return {
    name: qname,
    base,
    kind,
    enumeration,
    pattern,
    minLength,
    maxLength,
    minInclusive,
    maxInclusive,
  };
};

/**
 * Parse xs:complexType elements
 */
const parseComplexTypes = (
  schema: XmlNode,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
): ComplexTypeIR[] => {
  const complexTypes: ComplexTypeIR[] = [];
  const rawTypes = ensureArray<XmlNode>(getXsdElement(schema, 'complexType'));

  for (const ct of rawTypes) {
    const parsed = parseComplexType(ct, targetNamespace, nsMap);
    if (parsed) {
      complexTypes.push(parsed);
    }
  }

  return complexTypes;
};

/**
 * Parse a single xs:complexType
 */
const parseComplexType = (
  node: XmlNode,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
  syntheticName?: string,
): ComplexTypeIR | null => {
  const name = (node['@_name'] as string) || syntheticName || '__anonymous__';
  const qname: QName = { namespace: targetNamespace || '', localName: name };
  const mixed = node['@_mixed'] === 'true';
  const isAbstract = node['@_abstract'] === 'true';

  let base: QName | undefined;
  let contentModel: ParticleIR | undefined;
  let attributes: AttributeIR[] = [];

  // Check for simpleContent or complexContent
  const simpleContent = getFirst<XmlNode>(getXsdElement(node, 'simpleContent'));
  const complexContent = getFirst<XmlNode>(
    getXsdElement(node, 'complexContent'),
  );

  if (simpleContent) {
    const ext = getFirst<XmlNode>(getXsdElement(simpleContent, 'extension'));
    const rest = getFirst<XmlNode>(getXsdElement(simpleContent, 'restriction'));
    const derivation = ext || rest;

    if (derivation) {
      const baseAttr = derivation['@_base'] as string | undefined;
      if (baseAttr) {
        base = resolveQName(baseAttr, nsMap, targetNamespace);
      }
      attributes = parseAttributes(derivation, targetNamespace, nsMap);
    }
  } else if (complexContent) {
    const ext = getFirst<XmlNode>(getXsdElement(complexContent, 'extension'));
    const rest = getFirst<XmlNode>(
      getXsdElement(complexContent, 'restriction'),
    );
    const derivation = ext || rest;

    if (derivation) {
      const baseAttr = derivation['@_base'] as string | undefined;
      if (baseAttr) {
        base = resolveQName(baseAttr, nsMap, targetNamespace);
      }
      contentModel = parseContentModel(derivation, targetNamespace, nsMap);
      attributes = parseAttributes(derivation, targetNamespace, nsMap);
    }
  } else {
    // Direct content model
    contentModel = parseContentModel(node, targetNamespace, nsMap);
    attributes = parseAttributes(node, targetNamespace, nsMap);
  }

  return {
    name: qname,
    base,
    isAbstract,
    contentModel,
    attributes,
    mixed,
  };
};

/**
 * Parse content model (sequence/choice/all)
 */
const parseContentModel = (
  node: XmlNode,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
): ParticleIR | undefined => {
  const sequence = getFirst<XmlNode>(getXsdElement(node, 'sequence'));
  const choice = getFirst<XmlNode>(getXsdElement(node, 'choice'));
  const all = getFirst<XmlNode>(getXsdElement(node, 'all'));
  const group = getFirst<XmlNode>(getXsdElement(node, 'group'));

  if (sequence) {
    return parseModelGroup(sequence, 'sequence', targetNamespace, nsMap);
  }
  if (choice) {
    return parseModelGroup(choice, 'choice', targetNamespace, nsMap);
  }
  if (all) {
    return parseModelGroup(all, 'all', targetNamespace, nsMap);
  }
  if (group) {
    // Group reference
    const ref = group['@_ref'] as string | undefined;
    if (ref) {
      return {
        kind: 'group',
        compositor: 'sequence',
        occurs: parseOccurs(group),
        particles: [],
      } as ModelGroupParticleIR;
    }
  }

  return undefined;
};

/**
 * Parse a model group (sequence/choice/all)
 */
const parseModelGroup = (
  node: XmlNode,
  compositor: ModelCompositor,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
): ModelGroupParticleIR => {
  const particles: ParticleIR[] = [];

  // Parse nested elements
  const elements = ensureArray<XmlNode>(getXsdElement(node, 'element'));
  for (const el of elements) {
    particles.push(parseElementParticle(el, targetNamespace, nsMap));
  }

  // Parse nested sequences
  const sequences = ensureArray<XmlNode>(getXsdElement(node, 'sequence'));
  for (const seq of sequences) {
    particles.push(parseModelGroup(seq, 'sequence', targetNamespace, nsMap));
  }

  // Parse nested choices
  const choices = ensureArray<XmlNode>(getXsdElement(node, 'choice'));
  for (const ch of choices) {
    particles.push(parseModelGroup(ch, 'choice', targetNamespace, nsMap));
  }

  // Parse nested all
  const alls = ensureArray<XmlNode>(getXsdElement(node, 'all'));
  for (const a of alls) {
    particles.push(parseModelGroup(a, 'all', targetNamespace, nsMap));
  }

  // Parse xs:any wildcards
  const anys = ensureArray<XmlNode>(getXsdElement(node, 'any'));
  for (const any of anys) {
    particles.push(parseAnyParticle(any));
  }

  // Parse nested groups (references)
  const groups = ensureArray<XmlNode>(getXsdElement(node, 'group'));
  for (const grp of groups) {
    const ref = grp['@_ref'] as string | undefined;
    if (ref) {
      // For now, we'll treat group refs as empty sequences
      // Full resolution happens in the graph builder
      particles.push({
        kind: 'group',
        compositor: 'sequence',
        occurs: parseOccurs(grp),
        particles: [],
      });
    }
  }

  return {
    kind: 'group',
    compositor,
    occurs: parseOccurs(node),
    particles,
  };
};

/**
 * Parse an xs:any wildcard
 */
const parseAnyParticle = (node: XmlNode): AnyParticleIR => {
  return {
    kind: 'any',
    occurs: parseOccurs(node),
    namespace: (node['@_namespace'] as string) || '##any',
  };
};

/**
 * Parse an element particle
 */
const parseElementParticle = (
  node: XmlNode,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
): ElementParticleIR => {
  const ref = node['@_ref'] as string | undefined;
  const name = node['@_name'] as string | undefined;
  const typeAttr = node['@_type'] as string | undefined;

  if (ref) {
    return {
      kind: 'element',
      ref: resolveQName(ref, nsMap, targetNamespace),
      occurs: parseOccurs(node),
    };
  }

  const result: ElementParticleIR = {
    kind: 'element',
    name: name
      ? { namespace: targetNamespace || '', localName: name }
      : undefined,
    occurs: parseOccurs(node),
  };

  if (typeAttr) {
    result.type = resolveQName(typeAttr, nsMap, targetNamespace);
  } else {
    // Check for inline type
    const inlineSimple = getFirst<XmlNode>(getXsdElement(node, 'simpleType'));
    const inlineComplex = getFirst<XmlNode>(getXsdElement(node, 'complexType'));

    if (inlineSimple) {
      result.type =
        parseSimpleType(
          inlineSimple,
          targetNamespace,
          nsMap,
          `${name}__inline`,
        ) || undefined;
    } else if (inlineComplex) {
      result.type =
        parseComplexType(
          inlineComplex,
          targetNamespace,
          nsMap,
          `${name}__inline`,
        ) || undefined;
    }
  }

  return result;
};

/**
 * Parse attributes
 */
const parseAttributes = (
  node: XmlNode,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
): AttributeIR[] => {
  const attributes: AttributeIR[] = [];
  const rawAttrs = ensureArray<XmlNode>(getXsdElement(node, 'attribute'));

  for (const attr of rawAttrs) {
    const parsed = parseAttribute(attr, targetNamespace, nsMap);
    if (parsed) {
      attributes.push(parsed);
    }
  }

  return attributes;
};

/**
 * Parse a single attribute
 */
const parseAttribute = (
  node: XmlNode,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
): AttributeIR | null => {
  const name = node['@_name'] as string | undefined;
  const ref = node['@_ref'] as string | undefined;
  const typeAttr = node['@_type'] as string | undefined;
  const use = (node['@_use'] as AttributeUse) || 'optional';
  const defaultValue = node['@_default'] as string | undefined;
  const fixedValue = node['@_fixed'] as string | undefined;

  if (!name && !ref) {
    return null;
  }

  const attrName: QName = ref
    ? resolveQName(ref, nsMap, targetNamespace)
    : { namespace: '', localName: name! }; // Attributes typically have no namespace

  let type: QName | SimpleTypeIR;
  if (typeAttr) {
    type = resolveQName(typeAttr, nsMap, targetNamespace);
  } else {
    // Check for inline simpleType
    const inlineSimple = getFirst<XmlNode>(getXsdElement(node, 'simpleType'));
    if (inlineSimple) {
      type = parseSimpleType(
        inlineSimple,
        targetNamespace,
        nsMap,
        `${name}__attr`,
      ) || {
        name: { namespace: XS_NS, localName: 'string' },
        kind: 'string',
      };
    } else {
      // Default to string
      type = { namespace: XS_NS, localName: 'string' };
    }
  }

  return {
    name: attrName,
    type,
    use,
    defaultValue,
    fixedValue,
  };
};

/**
 * Parse global element declarations
 */
const parseElements = (
  schema: XmlNode,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
): ElementDeclIR[] => {
  const elements: ElementDeclIR[] = [];
  const rawElements = ensureArray<XmlNode>(getXsdElement(schema, 'element'));

  for (const el of rawElements) {
    const parsed = parseElementDecl(el, targetNamespace, nsMap);
    if (parsed) {
      elements.push(parsed);
    }
  }

  return elements;
};

/**
 * Parse a global element declaration
 */
const parseElementDecl = (
  node: XmlNode,
  targetNamespace: NamespaceURI | undefined,
  nsMap: Map<string, NamespaceURI>,
): ElementDeclIR | null => {
  const name = node['@_name'] as string | undefined;
  if (!name) {
    return null;
  }

  const qname: QName = { namespace: targetNamespace || '', localName: name };
  const typeAttr = node['@_type'] as string | undefined;
  const nillable = node['@_nillable'] === 'true';
  const substitutionGroupAttr = node['@_substitutionGroup'] as
    | string
    | undefined;

  let type: QName | ComplexTypeIR | SimpleTypeIR | undefined;

  if (typeAttr) {
    type = resolveQName(typeAttr, nsMap, targetNamespace);
  } else {
    // Check for inline type
    const inlineSimple = getFirst<XmlNode>(getXsdElement(node, 'simpleType'));
    const inlineComplex = getFirst<XmlNode>(getXsdElement(node, 'complexType'));

    if (inlineSimple) {
      type =
        parseSimpleType(
          inlineSimple,
          targetNamespace,
          nsMap,
          `${name}__type`,
        ) || undefined;
    } else if (inlineComplex) {
      type =
        parseComplexType(
          inlineComplex,
          targetNamespace,
          nsMap,
          `${name}__type`,
        ) || undefined;
    }
  }

  return {
    name: qname,
    type,
    nillable,
    substitutionGroup: substitutionGroupAttr
      ? resolveQName(substitutionGroupAttr, nsMap, targetNamespace)
      : undefined,
  };
};

// Helper: ensure value is an array with proper typing
const ensureArray = <T>(value: unknown): T[] => {
  if (value === undefined || value === null) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]) as T[];
};

// Helper: get first element of array or the value itself with proper typing
const getFirst = <T>(value: unknown): T | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  return (Array.isArray(value) ? value[0] : value) as T | undefined;
};

/**
 * Extract import/include/redefine directives from schema
 */
export interface SchemaDirective {
  type: 'import' | 'include' | 'redefine';
  namespace?: NamespaceURI;
  schemaLocation?: string;
}

export const extractDirectives = (content: string): SchemaDirective[] => {
  const doc = xmlParser.parse(content) as XmlNode;
  const schema = (doc['xs:schema'] || doc['xsd:schema'] || doc['schema']) as
    | XmlNode
    | undefined;

  if (!schema) {
    return [];
  }

  const directives: SchemaDirective[] = [];

  // Parse imports
  const imports = ensureArray<XmlNode>(getXsdElement(schema, 'import'));
  for (const imp of imports) {
    directives.push({
      type: 'import',
      namespace: imp['@_namespace'] as string | undefined,
      schemaLocation: imp['@_schemaLocation'] as string | undefined,
    });
  }

  // Parse includes
  const includes = ensureArray<XmlNode>(getXsdElement(schema, 'include'));
  for (const inc of includes) {
    directives.push({
      type: 'include',
      schemaLocation: inc['@_schemaLocation'] as string | undefined,
    });
  }

  // Parse redefines
  const redefines = ensureArray<XmlNode>(getXsdElement(schema, 'redefine'));
  for (const red of redefines) {
    directives.push({
      type: 'redefine',
      schemaLocation: red['@_schemaLocation'] as string | undefined,
    });
  }

  return directives;
};

/**
 * Extract target namespace from XSD content
 */
export const extractTargetNamespace = (
  content: string,
): NamespaceURI | undefined => {
  const doc = xmlParser.parse(content) as XmlNode;
  const schema = (doc['xs:schema'] || doc['xsd:schema'] || doc['schema']) as
    | XmlNode
    | undefined;
  return schema?.['@_targetNamespace'] as NamespaceURI | undefined;
};
