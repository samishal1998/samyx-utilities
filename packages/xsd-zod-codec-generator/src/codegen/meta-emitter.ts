/**
 * Meta Emitter - Generates static XmlMeta definitions from SchemaGraph
 *
 * This module generates TypeScript code with XmlMeta objects that can be
 * imported and used with attachMeta() for encoding data without first decoding.
 */

import type {
  AttributeIR,
  ComplexTypeIR,
  ElementDeclIR,
  ElementParticleIR,
  ModelGroupParticleIR,
  NamespaceURI,
  ParticleIR,
  QName,
  SchemaGraph,
  SimpleTypeIR,
} from '../xml-schema-graph-ir.js';
import { qNameKey } from '../xml-schema-graph-ir.js';
import { isBuiltInType, resolveType } from '../loader/schema-graph-builder.js';

/**
 * Options for meta generation
 */
export interface MetaEmitOptions {
  /** Strategy ID to use in generated meta (default: 'fxp-v1') */
  strategyId?: string;
  /** Use namespace prefixes in field xmlName */
  useNamespacePrefixes?: boolean;
}

/**
 * Generated meta module
 */
export interface GeneratedMetaModule {
  /** File name (without extension) */
  fileName: string;
  /** Full file content */
  content: string;
  /** QName of the source element */
  qname: QName;
  /** TypeScript identifier for the export */
  identifier: string;
}

/**
 * Result of meta generation for a pack
 */
export interface MetaEmitResult {
  /** Generated meta modules */
  modules: GeneratedMetaModule[];
  /** Index file content */
  index: string;
  /** Types file content (XmlMeta types) */
  types: string;
}

/**
 * Context for meta emission
 */
interface MetaEmitContext {
  graph: SchemaGraph;
  options: MetaEmitOptions;
  prefixMap: Map<NamespaceURI, string>;
  indent: number;
  /** Track visited types to prevent infinite recursion */
  visitedTypes: Set<string>;
  /** Track seen field names within current fields object to deduplicate */
  seenFields: Set<string>;
}

/**
 * Build namespace → prefix mapping from SchemaGraph
 */
const buildPrefixMap = (graph: SchemaGraph): Map<NamespaceURI, string> => {
  const prefixMap = new Map<NamespaceURI, string>();

  // Use prefixes from the graph (extracted from XSD xmlns declarations)
  for (const [uri, prefix] of graph.namespacePrefixes) {
    prefixMap.set(uri, prefix);
  }

  // Generate prefixes for any unmapped namespaces
  for (const ns of graph.namespaces) {
    if (!prefixMap.has(ns)) {
      const prefix = inferPrefixFromNamespace(ns);
      prefixMap.set(ns, prefix);
    }
  }

  return prefixMap;
};

/**
 * Infer a prefix from a namespace URI
 */
const inferPrefixFromNamespace = (ns: NamespaceURI): string => {
  // Common EPP namespaces
  if (ns.includes('urn:ietf:params:xml:ns:epp-1.0')) return 'epp';
  if (ns.includes('urn:ietf:params:xml:ns:domain-1.0')) return 'domain';
  if (ns.includes('urn:ietf:params:xml:ns:contact-1.0')) return 'contact';
  if (ns.includes('urn:ietf:params:xml:ns:host-1.0')) return 'host';
  if (ns.includes('urn:ietf:params:xml:ns:eppcom-1.0')) return 'eppcom';
  if (ns.includes('urn:ietf:params:xml:ns:secDNS')) return 'secDNS';
  if (ns.includes('fee')) return 'fee';

  // Try to extract from URI
  const parts = ns.split(/[/:]/);
  const lastPart = parts[parts.length - 1] || parts[parts.length - 2];

  if (lastPart) {
    return lastPart.replace(/-[\d.]+$/, '').replace(/[^a-zA-Z0-9]/g, '');
  }

  return 'ns';
};

/**
 * Get the prefixed name for XML
 */
const getPrefixedXmlName = (qname: QName, ctx: MetaEmitContext): string => {
  if (!ctx.options.useNamespacePrefixes) {
    return qname.localName;
  }

  const prefix = ctx.prefixMap.get(qname.namespace);
  return prefix ? `${prefix}:${qname.localName}` : qname.localName;
};

/**
 * Convert QName to TypeScript identifier for the meta export
 */
const qnameToMetaIdentifier = (qname: QName, ctx: MetaEmitContext): string => {
  const prefix = ctx.prefixMap.get(qname.namespace) || '';
  const localName =
    qname.localName.charAt(0).toUpperCase() + qname.localName.slice(1);
  const prefixPart = prefix
    ? prefix.charAt(0).toUpperCase() + prefix.slice(1)
    : '';
  return `${prefixPart}${localName}Meta`;
};

/**
 * Convert QName to file name
 */
const qnameToFileName = (qname: QName, ctx: MetaEmitContext): string => {
  const prefix = ctx.prefixMap.get(qname.namespace) || 'ns';
  return `${prefix}.${qname.localName}.meta`;
};

/**
 * Generate indentation
 */
const ind = (level: number): string => '  '.repeat(level);

/**
 * Determine cardinality from occurs
 */
const getCardinality = (min: number, max: number): 'one' | 'many' => {
  return max > 1 || max === Number.POSITIVE_INFINITY ? 'many' : 'one';
};

/**
 * Emit XmlNodeMeta for a complex type
 */
const emitNodeMeta = (
  qname: QName,
  complexType: ComplexTypeIR,
  ctx: MetaEmitContext,
): string => {
  const lines: string[] = [];
  const i = ctx.indent;

  // Reset seenFields for this node's fields object
  const nodeCtx: MetaEmitContext = {
    ...ctx,
    indent: i + 2,
    seenFields: new Set(),
  };

  lines.push(`${ind(i)}{`);
  lines.push(
    `${ind(i + 1)}qname: { namespace: ${JSON.stringify(qname.namespace)}, localName: ${JSON.stringify(qname.localName)} },`,
  );
  lines.push(`${ind(i + 1)}fields: {`);

  // Emit attributes
  for (const attr of complexType.attributes) {
    const attrMeta = emitAttributeFieldMeta(attr, nodeCtx);
    lines.push(attrMeta);
  }

  // Emit child elements from content model
  if (complexType.contentModel) {
    const childFields = emitContentModelFields(
      complexType.contentModel,
      nodeCtx,
    );
    lines.push(...childFields);
  }

  lines.push(`${ind(i + 1)}},`);
  lines.push(`${ind(i)}}`);

  return lines.join('\n');
};

/**
 * Emit attribute field metadata
 */
const emitAttributeFieldMeta = (
  attr: AttributeIR,
  ctx: MetaEmitContext,
): string => {
  const i = ctx.indent;
  const fieldName = attr.name.localName;
  const cardinality = attr.use === 'required' ? 'one' : 'one'; // attributes are always 'one'

  const lines: string[] = [];
  lines.push(`${ind(i)}${JSON.stringify(fieldName)}: {`);
  lines.push(`${ind(i + 1)}kind: 'attribute',`);
  lines.push(`${ind(i + 1)}xmlName: ${JSON.stringify(attr.name.localName)},`);
  if (attr.name.namespace) {
    lines.push(
      `${ind(i + 1)}namespace: ${JSON.stringify(attr.name.namespace)},`,
    );
  }
  lines.push(`${ind(i + 1)}cardinality: '${cardinality}',`);
  lines.push(`${ind(i)}},`);

  return lines.join('\n');
};

/**
 * Emit fields from content model
 */
const emitContentModelFields = (
  particle: ParticleIR,
  ctx: MetaEmitContext,
): string[] => {
  const lines: string[] = [];

  if (particle.kind === 'element') {
    const elemParticle = particle as ElementParticleIR;
    const fieldMeta = emitElementFieldMeta(elemParticle, ctx);
    if (fieldMeta) {
      lines.push(fieldMeta);
    }
  } else if (particle.kind === 'group') {
    const groupParticle = particle as ModelGroupParticleIR;
    for (const child of groupParticle.particles) {
      lines.push(...emitContentModelFields(child, ctx));
    }
  }
  // 'any' particles are skipped for meta generation

  return lines;
};

/**
 * Emit element field metadata
 */
const emitElementFieldMeta = (
  elemParticle: ElementParticleIR,
  ctx: MetaEmitContext,
): string | null => {
  const i = ctx.indent;

  // Determine the element's QName
  let elemQName: QName | undefined;
  if (elemParticle.ref) {
    elemQName = elemParticle.ref;
  } else if (elemParticle.name) {
    elemQName = elemParticle.name;
  }

  if (!elemQName) {
    return null;
  }

  const xmlName = getPrefixedXmlName(elemQName, ctx);
  const fieldName = xmlName; // Use prefixed name as field key to ensure uniqueness

  // Skip duplicate fields (can happen when XSD has same element ref multiple times in choice)
  if (ctx.seenFields.has(fieldName)) {
    return null;
  }
  ctx.seenFields.add(fieldName);

  const cardinality = getCardinality(
    elemParticle.occurs.min,
    elemParticle.occurs.max,
  );

  const lines: string[] = [];
  lines.push(`${ind(i)}${JSON.stringify(fieldName)}: {`);
  lines.push(`${ind(i + 1)}kind: 'element',`);
  lines.push(`${ind(i + 1)}xmlName: ${JSON.stringify(xmlName)},`);
  lines.push(`${ind(i + 1)}namespace: ${JSON.stringify(elemQName.namespace)},`);
  lines.push(`${ind(i + 1)}cardinality: '${cardinality}',`);

  // Check if we should emit nested nodeMeta
  const nestedMeta = tryEmitNestedNodeMeta(elemParticle, ctx);
  if (nestedMeta) {
    lines.push(`${ind(i + 1)}nodeMeta: ${nestedMeta},`);
  }

  lines.push(`${ind(i)}},`);

  return lines.join('\n');
};

/**
 * Try to emit nested nodeMeta for an element
 */
const tryEmitNestedNodeMeta = (
  elemParticle: ElementParticleIR,
  ctx: MetaEmitContext,
): string | null => {
  // Get the element's type
  let typeIr: ComplexTypeIR | SimpleTypeIR | undefined;
  let elemQName: QName | undefined;

  if (elemParticle.ref) {
    // Look up the global element
    const elemDecl = ctx.graph.elements.get(qNameKey(elemParticle.ref));
    if (
      elemDecl?.type &&
      typeof elemDecl.type === 'object' &&
      'contentModel' in elemDecl.type
    ) {
      typeIr = elemDecl.type as ComplexTypeIR;
      elemQName = elemParticle.ref;
    } else if (
      elemDecl?.type &&
      typeof elemDecl.type === 'object' &&
      'namespace' in elemDecl.type
    ) {
      // It's a QName reference to a type
      const resolvedType = resolveType(elemDecl.type as QName, ctx.graph);
      if (resolvedType && 'contentModel' in resolvedType) {
        typeIr = resolvedType as ComplexTypeIR;
        elemQName = elemParticle.ref;
      }
    }
  } else if (elemParticle.type) {
    if (
      typeof elemParticle.type === 'object' &&
      'contentModel' in elemParticle.type
    ) {
      typeIr = elemParticle.type as ComplexTypeIR;
      elemQName = elemParticle.name;
    } else if (
      typeof elemParticle.type === 'object' &&
      'namespace' in elemParticle.type &&
      'localName' in elemParticle.type
    ) {
      // QName reference
      const resolvedType = resolveType(elemParticle.type as QName, ctx.graph);
      if (resolvedType && 'contentModel' in resolvedType) {
        typeIr = resolvedType as ComplexTypeIR;
        elemQName = elemParticle.name;
      }
    }
  }

  // If we have a complex type, emit its nodeMeta
  if (typeIr && 'contentModel' in typeIr && elemQName) {
    // Check for circular reference
    const typeKey = qNameKey(typeIr.name);
    if (ctx.visitedTypes.has(typeKey)) {
      return null; // Skip to prevent infinite recursion
    }

    // Add to visited and emit
    const newCtx = {
      ...ctx,
      indent: 0,
      visitedTypes: new Set([...ctx.visitedTypes, typeKey]),
    };

    return emitNodeMeta(elemQName, typeIr, newCtx);
  }

  return null;
};

/**
 * Emit a single meta module for an element
 */
const emitMetaModule = (
  element: ElementDeclIR,
  ctx: MetaEmitContext,
): GeneratedMetaModule | null => {
  // Get the element's complex type
  let complexType: ComplexTypeIR | undefined;

  if (element.type) {
    if (typeof element.type === 'object' && 'contentModel' in element.type) {
      // Inline complex type
      complexType = element.type as ComplexTypeIR;
    } else if (
      typeof element.type === 'object' &&
      'namespace' in element.type
    ) {
      // Reference to a named type
      const resolved = resolveType(element.type as QName, ctx.graph);
      if (resolved && 'contentModel' in resolved) {
        complexType = resolved as ComplexTypeIR;
      }
    }
  }

  // Skip elements without complex types (simple content elements don't need full meta)
  if (!complexType) {
    return null;
  }

  const identifier = qnameToMetaIdentifier(element.name, ctx);
  const fileName = qnameToFileName(element.name, ctx);
  const strategyId = ctx.options.strategyId || 'fxp-v1';

  // Reset visited types and seenFields for each root element
  const nodeCtx: MetaEmitContext = {
    ...ctx,
    indent: 1,
    visitedTypes: new Set([qNameKey(complexType.name)]),
    seenFields: new Set(),
  };

  const nodeMeta = emitNodeMeta(element.name, complexType, nodeCtx);

  const content = `/**
 * Static XmlMeta for ${element.name.localName}
 * Generated from: ${element.name.namespace}
 *
 * @generated - Do not edit manually
 */

import type { XmlMeta } from './types';

export const ${identifier}: XmlMeta = {
  strategyId: '${strategyId}',
  root: ${nodeMeta
    .split('\n')
    .map((line, i) => (i === 0 ? line.trim() : line))
    .join('\n')},
};
`;

  return {
    fileName,
    content,
    qname: element.name,
    identifier,
  };
};

/**
 * Generate the types file content
 */
const generateTypesContent = (): string => {
  return `/**
 * XmlMeta Types
 * @generated - Do not edit manually
 */

/**
 * Qualified Name: namespace + localName.
 */
export interface QName {
  namespace?: string;
  localName: string;
}

/**
 * Root metadata for Layer 2 encoding/decoding.
 */
export interface XmlMeta {
  strategyId: string;
  root: XmlNodeMeta;
}

/**
 * Metadata for a single XML element.
 */
export interface XmlNodeMeta {
  qname: QName;
  value?: XmlValueMeta;
  fields: Record<string, XmlFieldMeta>;
}

/** Common fields for field metadata. */
export interface XmlFieldBaseMeta {
  xmlName: string;
  namespace?: string;
  cardinality: 'one' | 'many';
  typeHint?: string;
}

/** Attribute field metadata. */
export interface XmlAttributeFieldMeta extends XmlFieldBaseMeta {
  kind: 'attribute';
}

/** Element field metadata. */
export interface XmlElementFieldMeta extends XmlFieldBaseMeta {
  kind: 'element';
  nodeMeta?: XmlNodeMeta;
}

/** Value metadata for text content. */
export interface XmlValueMeta extends XmlFieldBaseMeta {
  kind: 'value';
}

/** Union of field metadata types. */
export type XmlFieldMeta = XmlAttributeFieldMeta | XmlElementFieldMeta;
`;
};

/**
 * Generate meta modules for all elements in a SchemaGraph
 */
export const emitMeta = (
  graph: SchemaGraph,
  options: MetaEmitOptions = {},
): MetaEmitResult => {
  const prefixMap = buildPrefixMap(graph);

  const ctx: MetaEmitContext = {
    graph,
    options: {
      strategyId: options.strategyId || 'fxp-v1',
      useNamespacePrefixes: options.useNamespacePrefixes ?? true,
    },
    prefixMap,
    indent: 0,
    visitedTypes: new Set(),
    seenFields: new Set(),
  };

  const modules: GeneratedMetaModule[] = [];

  // Generate meta for each global element
  for (const [_key, element] of graph.elements) {
    const module = emitMetaModule(element, ctx);
    if (module) {
      modules.push(module);
    }
  }

  // Generate index file
  const indexLines: string[] = [
    '/**',
    ' * Static XmlMeta exports',
    ' * @generated - Do not edit manually',
    ' */',
    '',
    "export * from './types';",
    '',
  ];

  for (const module of modules) {
    indexLines.push(
      `export { ${module.identifier} } from './${module.fileName}';`,
    );
  }

  indexLines.push('');

  return {
    modules,
    index: indexLines.join('\n'),
    types: generateTypesContent(),
  };
};

/**
 * Get all generated meta file names for a result
 */
export const getMetaFileNames = (result: MetaEmitResult): string[] => {
  return result.modules.map((m) => m.fileName);
};
