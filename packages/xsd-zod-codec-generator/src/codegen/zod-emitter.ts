/**
 * Zod Emitter - Generates Zod schema code from SchemaGraph IR
 *
 * This module traverses the SchemaGraph and emits TypeScript code
 * with Zod schemas for Layer 1 XML JSON shapes.
 *
 * Features:
 * - Schema reuse via imports (no inlining)
 * - Choice → z.union() mapping
 * - Branded types for all elements
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
 * Simple node schema mode
 */
export type SimpleNodeSchemaMode = 'force-object' | 'automatic' | 'both';

/**
 * Options for code generation
 */
export interface CodegenOptions {
  /** Emit schemas for complex types (not just global elements) */
  emitComplexTypes?: boolean;
  /** Use namespace prefixes in property names */
  useNamespacePrefixes?: boolean;
  /** Namespace → prefix mapping */
  namespacePrefix?: Map<NamespaceURI, string>;
  /** Add .brand<"ns:name">() to schemas for type discrimination (default: true) */
  brand?: boolean;
  /** Add .passthrough() to allow extra properties (for xmlns, etc.) */
  loose?: boolean;
  /** Treat all elements as arrays regardless of maxOccurs */
  alwaysArray?: boolean;
  /** Simple node schema mode: force-object, automatic, both (default: automatic) */
  simpleNodeSchema?: SimpleNodeSchemaMode;
}

/**
 * Generated code for a single schema module
 */
export interface GeneratedModule {
  /** File name (without extension) */
  fileName: string;
  /** Full file content */
  content: string;
  /** QName of the generated element/type */
  qname: QName;
  /** Whether this is an element or type */
  kind: 'element' | 'type';
  /** Dependencies on other modules */
  dependencies: Set<string>;
}

/**
 * Singular node info for isSingularNode predicate
 */
export interface SingularNodeInfo {
  /** Prefixed node name (e.g., "domain:name") */
  nodeName: string;
  /** Parent paths where this node is singular (empty means always singular) */
  parentPaths?: string[];
}

/**
 * Node with attributes info for doesNodeHaveAttributes predicate
 */
export interface NodeWithAttributesInfo {
  /** Prefixed node name (e.g., "domain:name") */
  nodeName: string;
  /** Parent paths where this node has attributes defined */
  parentPaths?: string[];
}

/**
 * Result of code generation for a pack
 */
export interface CodegenResult {
  /** Generated element modules */
  elements: GeneratedModule[];
  /** Generated type modules (if emitComplexTypes is true) */
  types: GeneratedModule[];
  /** Schema metadata content */
  schemaMeta: string;
  /** Index file content */
  index: string;
  /** Singular nodes info for isSingularNode predicate (when not using alwaysArray) */
  singularNodes: SingularNodeInfo[];
  /** Nodes with attributes info for doesNodeHaveAttributes predicate */
  nodesWithAttributes: NodeWithAttributesInfo[];
  /** Whether loose mode is enabled (needs zloosen helper) */
  loose: boolean;
}

/**
 * Context passed through code generation
 */
interface EmitContext {
  graph: SchemaGraph;
  options: CodegenOptions;
  prefixMap: Map<NamespaceURI, string>;
  indent: number;
  /** Current element being generated (for self-reference detection) */
  currentElement?: QName;
  /** Current type being generated (for self-reference detection) */
  currentType?: QName;
  /** Dependencies collected during emission */
  dependencies: Set<string>;
  /** Map of QName key → identifier for imports */
  elementIdentifiers: Map<string, string>;
  /** Map of QName key → file name for imports */
  elementFileNames: Map<string, string>;
  /** Map of QName key → identifier for type imports */
  typeIdentifiers: Map<string, string>;
  /** Map of QName key → file name for type imports */
  typeFileNames: Map<string, string>;
  /** Local variable declarations to emit before main schema */
  localVars: string[];
  /** Counter for generating unique local var names */
  localVarCounter: number;
}

/**
 * Build namespace → prefix mapping from namespaces
 */
const buildPrefixMap = (
  namespaces: NamespaceURI[],
  customMap?: Map<NamespaceURI, string>,
): Map<NamespaceURI, string> => {
  const prefixMap = new Map<NamespaceURI, string>();

  // Use custom mappings first
  if (customMap) {
    for (const [ns, prefix] of customMap) {
      prefixMap.set(ns, prefix);
    }
  }

  // Generate prefixes for unmapped namespaces
  for (const ns of namespaces) {
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
    // Remove version suffix
    return lastPart.replace(/-[\d.]+$/, '').replace(/[^a-zA-Z0-9]/g, '');
  }

  return 'ns';
};

/**
 * Get the prefixed element name for use in JSON keys
 */
const getPrefixedName = (qname: QName, ctx: EmitContext): string => {
  if (!ctx.options.useNamespacePrefixes) {
    return qname.localName;
  }

  const prefix = ctx.prefixMap.get(qname.namespace);
  return prefix ? `${prefix}:${qname.localName}` : qname.localName;
};

/**
 * Get the brand string for an element
 */
const getBrandString = (qname: QName, ctx: EmitContext): string => {
  const prefix = ctx.prefixMap.get(qname.namespace);
  return prefix ? `${prefix}:${qname.localName}` : qname.localName;
};

/**
 * Convert QName to a valid TypeScript identifier
 */
const qnameToIdentifier = (qname: QName, ctx: EmitContext): string => {
  const prefix = ctx.prefixMap.get(qname.namespace) || '';
  const localName =
    qname.localName.charAt(0).toUpperCase() + qname.localName.slice(1);
  const prefixPart = prefix
    ? prefix.charAt(0).toUpperCase() + prefix.slice(1)
    : '';
  return `${prefixPart}${localName}Xml`;
};

/**
 * Convert QName to file name
 */
const qnameToFileName = (qname: QName, ctx: EmitContext): string => {
  const prefix = ctx.prefixMap.get(qname.namespace) || 'ns';
  return `${prefix}.${qname.localName}.layer1`;
};

/**
 * Generate indentation string
 */
const indent = (level: number): string => '  '.repeat(level);

/**
 * Emit Zod schema for a simple type
 */
const emitSimpleType = (st: SimpleTypeIR, ctx: EmitContext): string => {
  // Handle enumerations
  if (st.enumeration && st.enumeration.length > 0) {
    const values = st.enumeration.map((v) => JSON.stringify(v)).join(', ');
    return `z.enum([${values}])`;
  }

  // Handle patterns
  if (st.pattern) {
    return `z.string().regex(/${st.pattern}/)`;
  }

  // Base type mapping
  switch (st.kind) {
    case 'string':
      return emitStringType(st);
    case 'boolean':
      // XML booleans can be "true", "false", "1", "0"
      return `z.union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])`;
    case 'decimal':
    case 'integer':
      return emitNumericType(st);
    case 'dateTime':
    case 'date':
    case 'time':
      return 'z.string()'; // Date/time as strings in XML
    default:
      return 'z.string()';
  }
};

/**
 * Emit string type with constraints
 */
const emitStringType = (st: SimpleTypeIR): string => {
  const constraints: string[] = [];

  if (st.minLength !== undefined) {
    constraints.push(`.min(${st.minLength})`);
  }
  if (st.maxLength !== undefined) {
    constraints.push(`.max(${st.maxLength})`);
  }

  return `z.string()${constraints.join('')}`;
};

/**
 * Emit numeric type (as string since XML values are strings)
 */
const emitNumericType = (st: SimpleTypeIR): string => {
  // In XML JSON, numbers come as strings, so we validate the pattern
  if (st.kind === 'integer') {
    return 'z.string().regex(/^-?\\d+$/)';
  }
  return 'z.string().regex(/^-?\\d+(\\.\\d+)?$/)';
};

/**
 * Wrap a simple schema based on the simpleNodeSchema mode.
 * This handles how text-only elements (with no attributes) are represented.
 *
 * - 'automatic': Return the simple schema as-is (e.g., z.string())
 * - 'force-object': Wrap in object with #text (e.g., z.object({ "#text": z.string() }))
 * - 'both': Union of simple and object form
 */
const wrapSimpleSchemaForMode = (schema: string, ctx: EmitContext): string => {
  const mode = ctx.options.simpleNodeSchema || 'automatic';

  switch (mode) {
    case 'force-object': {
      const objectSchema = `z.object({ ${JSON.stringify('#text')}: ${schema} })`;
      return ctx.options.loose ? `zloosen(${objectSchema})` : objectSchema;
    }
    case 'both': {
      const objectSchema = `z.object({ ${JSON.stringify('#text')}: ${schema} })`;
      const wrappedObject = ctx.options.loose
        ? `zloosen(${objectSchema})`
        : objectSchema;
      return `z.union([${schema}, ${wrappedObject}])`;
    }
    case 'automatic':
    default:
      return schema;
  }
};

/**
 * Check if a type is a named complex type that should be referenced by import
 */
const isNamedComplexType = (qname: QName, ctx: EmitContext): boolean => {
  const key = qNameKey(qname);
  return ctx.typeIdentifiers.has(key);
};

/**
 * Emit Zod schema for a type reference (QName)
 */
const emitTypeRef = (qname: QName, ctx: EmitContext): string => {
  // Handle built-in XSD types
  if (isBuiltInType(qname)) {
    return emitBuiltInType(qname.localName);
  }

  // Look up the type in the graph
  const resolved = resolveType(qname, ctx.graph);
  if (!resolved) {
    // Unknown type, default to any
    return 'z.unknown()';
  }

  // Check if it's a simple type
  if ('kind' in resolved && !('contentModel' in resolved)) {
    return emitSimpleType(resolved as SimpleTypeIR, ctx);
  }

  // Check if it's a named complex type - use import instead of inlining
  if (isNamedComplexType(qname, ctx)) {
    const typeKey = qNameKey(qname);
    const identifier = ctx.typeIdentifiers.get(typeKey);
    const fileName = ctx.typeFileNames.get(typeKey);

    if (identifier && fileName) {
      // Check for self-reference (type referring to itself)
      const isSelfRef =
        ctx.currentType && qNameKey(ctx.currentType) === typeKey;

      if (isSelfRef) {
        // Self-reference - use z.lazy()
        return `z.lazy(() => ${identifier})`;
      }

      // Add as dependency and return identifier
      ctx.dependencies.add(`type:${typeKey}`);
      return identifier;
    }
  }

  // Complex type - inline it (for anonymous types or fallback)
  return emitComplexTypeBody(resolved as ComplexTypeIR, ctx);
};

/**
 * Emit Zod schema for a type reference when used as element content.
 * This wraps simple types based on the simpleNodeSchema mode.
 */
const emitTypeRefForElement = (qname: QName, ctx: EmitContext): string => {
  // Handle built-in XSD types - these are always simple
  if (isBuiltInType(qname)) {
    const simpleSchema = emitBuiltInType(qname.localName);
    return wrapSimpleSchemaForMode(simpleSchema, ctx);
  }

  // Look up the type in the graph
  const resolved = resolveType(qname, ctx.graph);
  if (!resolved) {
    return 'z.unknown()';
  }

  // Check if it's a simple type
  if ('kind' in resolved && !('contentModel' in resolved)) {
    const simpleSchema = emitSimpleType(resolved as SimpleTypeIR, ctx);
    return wrapSimpleSchemaForMode(simpleSchema, ctx);
  }

  // Check if it's a named complex type - use import instead of inlining
  if (isNamedComplexType(qname, ctx)) {
    const typeKey = qNameKey(qname);
    const identifier = ctx.typeIdentifiers.get(typeKey);
    const fileName = ctx.typeFileNames.get(typeKey);

    if (identifier && fileName) {
      // Check for self-reference (type referring to itself)
      const isSelfRef =
        ctx.currentType && qNameKey(ctx.currentType) === typeKey;

      if (isSelfRef) {
        return `z.lazy(() => ${identifier})`;
      }

      ctx.dependencies.add(`type:${typeKey}`);
      return identifier;
    }
  }

  // Complex type - inline it (for anonymous types or fallback)
  return emitComplexTypeBody(resolved as ComplexTypeIR, ctx);
};

/**
 * Emit Zod schema for built-in XSD types
 */
const emitBuiltInType = (localName: string): string => {
  switch (localName) {
    case 'string':
    case 'normalizedString':
    case 'token':
    case 'language':
    case 'NMTOKEN':
    case 'Name':
    case 'NCName':
    case 'ID':
    case 'IDREF':
    case 'anyURI':
    case 'base64Binary':
    case 'hexBinary':
    case 'duration':
    case 'QName':
      return 'z.string()';

    case 'boolean':
      return `z.union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])`;

    case 'decimal':
    case 'float':
    case 'double':
      return 'z.string().regex(/^-?\\d+(\\.\\d+)?([eE][+-]?\\d+)?$/)';

    case 'integer':
    case 'long':
    case 'int':
    case 'short':
    case 'byte':
    case 'nonPositiveInteger':
    case 'negativeInteger':
    case 'nonNegativeInteger':
    case 'positiveInteger':
    case 'unsignedLong':
    case 'unsignedInt':
    case 'unsignedShort':
    case 'unsignedByte':
      return 'z.string().regex(/^-?\\d+$/)';

    case 'dateTime':
    case 'date':
    case 'time':
    case 'gYear':
    case 'gYearMonth':
    case 'gMonth':
    case 'gMonthDay':
    case 'gDay':
      return 'z.string()';

    case 'anyType':
    case 'anySimpleType':
      return 'z.unknown()';

    default:
      return 'z.string()';
  }
};

/**
 * Emit Zod schema for an attribute
 */
const emitAttribute = (attr: AttributeIR, ctx: EmitContext): string => {
  const key = `@_${attr.name.localName}`;
  let schema: string;

  // Get the type schema
  if ('namespace' in attr.type && 'localName' in attr.type) {
    schema = emitTypeRef(attr.type as QName, ctx);
  } else {
    schema = emitSimpleType(attr.type as SimpleTypeIR, ctx);
  }

  // Handle fixed values
  if (attr.fixedValue !== undefined) {
    schema = `z.literal(${JSON.stringify(attr.fixedValue)})`;
  }

  // Handle default values
  if (attr.defaultValue !== undefined) {
    schema = `${schema}.default(${JSON.stringify(attr.defaultValue)})`;
  }

  // Handle optionality
  if (attr.use === 'optional') {
    schema = `${schema}.optional()`;
  }

  return `${JSON.stringify(key)}: ${schema}`;
};

/**
 * Emit Zod schema for a complex type body
 */
const emitComplexTypeBody = (ct: ComplexTypeIR, ctx: EmitContext): string => {
  const props: string[] = [];
  const i = indent(ctx.indent + 1);

  // Handle base type extension
  if (ct.base && !isBuiltInType(ct.base)) {
    const baseType = resolveType(ct.base, ctx.graph);
    if (baseType && 'attributes' in baseType) {
      // Merge base type attributes
      for (const attr of (baseType as ComplexTypeIR).attributes) {
        props.push(emitAttribute(attr, ctx));
      }
    }
  }

  // Emit attributes
  for (const attr of ct.attributes) {
    props.push(emitAttribute(attr, ctx));
  }

  // Handle mixed content (text + elements)
  if (ct.mixed) {
    props.push(`${JSON.stringify('#text')}: z.string().optional()`);
  }

  // Handle simple content (just text with attributes)
  // This handles both built-in types and user-defined simple types as base
  if (ct.base && !ct.contentModel) {
    if (isBuiltInType(ct.base)) {
      props.push(
        `${JSON.stringify('#text')}: ${emitBuiltInType(ct.base.localName)}`,
      );
    } else {
      // Check if base is a simple type
      const baseType = resolveType(ct.base, ctx.graph);
      if (baseType && 'kind' in baseType && !('contentModel' in baseType)) {
        // It's a SimpleType - emit the text content
        props.push(
          `${JSON.stringify('#text')}: ${emitSimpleType(baseType as SimpleTypeIR, ctx)}`,
        );
      }
    }
  }

  // Emit content model
  if (ct.contentModel) {
    const contentResult = emitParticle(ct.contentModel, ctx);
    if (contentResult.isUnion) {
      // The content model is a choice - wrap the whole type
      if (props.length === 0) {
        return contentResult.schema;
      }
      // Has attributes + choice content - spread base into each union option
      if (contentResult.unionOptionProps) {
        const baseVarName = `_base${ctx.localVarCounter++}`;
        const baseSchema = `z.object({\n${i}${props.join(`,\n${i}`)},\n${indent(ctx.indent)}})`;
        ctx.localVars.push(`const ${baseVarName} = ${baseSchema};`);

        const unionMembers = contentResult.unionOptionProps.map((optProps) => {
          const objSchema = `z.object({\n${i}  ...${baseVarName}.shape,\n${i}  ${optProps.join(`,\n${i}  `)},\n${i}})`;
          return ctx.options.loose ? `zloosen(${objSchema})` : objSchema;
        });

        return `z.union([\n${i}${unionMembers.join(`,\n${i}`)},\n${indent(ctx.indent)}])`;
      }
      // Fallback if no unionOptionProps available (shouldn't happen normally)
      const attrsObj = `z.object({\n${i}${props.join(`,\n${i}`)},\n${indent(ctx.indent)}})`;
      return `${attrsObj}.and(${contentResult.schema})`;
    }
    props.push(...contentResult.props);
  }

  if (props.length === 0) {
    const baseSchema = 'z.object({})';
    return ctx.options.loose ? `zloosen(${baseSchema})` : baseSchema;
  }

  const baseSchema = `z.object({\n${i}${props.join(`,\n${i}`)},\n${indent(ctx.indent)}})`;
  return ctx.options.loose ? `zloosen(${baseSchema})` : baseSchema;
};

/**
 * Result of emitting a particle - can be props or a union schema
 */
interface ParticleEmitResult {
  props: string[];
  isUnion: boolean;
  schema: string;
  /** For unions, the individual choice option props (used for spreading base.shape) */
  unionOptionProps?: string[][];
}

/**
 * Emit Zod properties for a particle
 */
const emitParticle = (
  particle: ParticleIR,
  ctx: EmitContext,
): ParticleEmitResult => {
  switch (particle.kind) {
    case 'element':
      return {
        props: emitElementParticle(particle as ElementParticleIR, ctx),
        isUnion: false,
        schema: '',
      };
    case 'group':
      return emitModelGroupParticle(particle as ModelGroupParticleIR, ctx);
    case 'any':
      // xs:any becomes z.record for extra properties
      return { props: [], isUnion: false, schema: '' };
    default:
      return { props: [], isUnion: false, schema: '' };
  }
};

/**
 * Emit Zod properties for an element particle
 */
const emitElementParticle = (
  particle: ElementParticleIR,
  ctx: EmitContext,
): string[] => {
  // Determine element name
  let elemName: QName;
  let elemType: QName | ComplexTypeIR | SimpleTypeIR | undefined;
  let isGlobalElementRef = false;

  if (particle.ref) {
    // Reference to global element - use import instead of inlining
    const elem = ctx.graph.elements.get(qNameKey(particle.ref));
    if (!elem) {
      return [];
    }
    elemName = elem.name;
    elemType = elem.type;
    isGlobalElementRef = true;
  } else if (particle.name) {
    elemName = particle.name;
    elemType = particle.type;
  } else {
    return [];
  }

  const key = getPrefixedName(elemName, ctx);
  let schema: string;

  // For global element refs, use the imported schema
  if (isGlobalElementRef) {
    const refKey = qNameKey(particle.ref!);
    const identifier = ctx.elementIdentifiers.get(refKey);
    const fileName = ctx.elementFileNames.get(refKey);

    if (identifier && fileName) {
      // Check for self-reference (element referring to itself)
      const isSelfRef =
        ctx.currentElement && qNameKey(ctx.currentElement) === refKey;

      if (isSelfRef) {
        // Self-reference - use z.lazy()
        schema = `z.lazy(() => ${identifier})`;
      } else {
        // Add as dependency and use identifier
        ctx.dependencies.add(refKey);
        schema = identifier;
      }
    } else {
      // Fallback to inlining if identifier not found
      schema = emitElementTypeSchema(elemType, ctx);
    }
  } else {
    // Inline local element type
    schema = emitElementTypeSchema(elemType, ctx);
  }

  // Handle cardinality
  const { min, max } = particle.occurs;
  const forceArray = ctx.options.alwaysArray;

  if (forceArray || max === Number.POSITIVE_INFINITY || max > 1) {
    // Array type (or forced array mode)
    schema = `z.array(${schema})`;
    if (min === 0) {
      schema = `${schema}.optional()`;
    } else if (min > 0 && !forceArray) {
      // Only add min constraint when not in forceArray mode
      schema = `${schema}.min(${min})`;
    }
  } else if (min === 0) {
    // Optional single element
    schema = `${schema}.optional()`;
  }

  return [`${JSON.stringify(key)}: ${schema}`];
};

/**
 * Emit schema for an element's type
 */
const emitElementTypeSchema = (
  elemType: QName | ComplexTypeIR | SimpleTypeIR | undefined,
  ctx: EmitContext,
): string => {
  if (elemType) {
    if ('namespace' in elemType && 'localName' in elemType) {
      return emitTypeRefForElement(elemType as QName, ctx);
    }
    if ('kind' in elemType && !('contentModel' in elemType)) {
      // Inline simple type - wrap based on simpleNodeSchema mode
      const simpleSchema = emitSimpleType(elemType as SimpleTypeIR, ctx);
      return wrapSimpleSchemaForMode(simpleSchema, ctx);
    }
    if ('contentModel' in elemType || 'attributes' in elemType) {
      return emitComplexTypeBody(elemType as ComplexTypeIR, ctx);
    }

    return 'z.unknown()';
  }
  // No type - default to string, wrap based on mode
  return wrapSimpleSchemaForMode('z.string()', ctx);
};

/**
 * Emit Zod properties for a model group particle
 */
const emitModelGroupParticle = (
  particle: ModelGroupParticleIR,
  ctx: EmitContext,
): ParticleEmitResult => {
  if (particle.compositor === 'choice') {
    // Build union of all choice options - collect props for each option
    const unionOptionProps: string[][] = [];
    const i = indent(ctx.indent + 1);

    for (const child of particle.particles) {
      const childResult = emitParticle(child, ctx);

      if (childResult.isUnion && childResult.unionOptionProps) {
        // Nested union - flatten it by adding each option
        for (const optionProps of childResult.unionOptionProps) {
          unionOptionProps.push(optionProps);
        }
      } else if (childResult.props.length > 0) {
        unionOptionProps.push(childResult.props);
      }
    }

    if (unionOptionProps.length === 0) {
      return { props: [], isUnion: false, schema: '' };
    }

    if (unionOptionProps.length === 1) {
      // Single option - not really a choice, return as regular props
      return { props: unionOptionProps[0], isUnion: false, schema: '' };
    }

    // Build z.union - each option becomes z.object({ ...props })
    const unionMembers = unionOptionProps.map((optProps) => {
      const objSchema = `z.object({\n${i}  ${optProps.join(`,\n${i}  `)},\n${i}})`;
      return ctx.options.loose ? `zloosen(${objSchema})` : objSchema;
    });

    const unionSchema = `z.union([\n${i}${unionMembers.join(`,\n${i}`)},\n${indent(ctx.indent)}])`;
    return { props: [], isUnion: true, schema: unionSchema, unionOptionProps };
  }
  // Sequence or all - collect all children
  const props: string[] = [];
  let nestedUnion: ParticleEmitResult | null = null;

  for (const child of particle.particles) {
    const childResult = emitParticle(child, ctx);
    if (childResult.isUnion) {
      // Found a choice within sequence - save it for later
      nestedUnion = childResult;
    } else {
      props.push(...childResult.props);
    }
  }

  // If we have a nested union (choice in sequence), extract base as local var and spread
  if (nestedUnion && nestedUnion.unionOptionProps) {
    const i = indent(ctx.indent + 1);

    // Only extract base if there are base props
    if (props.length > 0) {
      // Generate unique local var name
      const baseVarName = `_base${ctx.localVarCounter++}`;
      const baseSchema = `z.object({\n  ${props.join(',\n  ')},\n})`;
      ctx.localVars.push(`const ${baseVarName} = ${baseSchema};`);

      // Each union option spreads base and adds its own props
      const unionMembers = nestedUnion.unionOptionProps.map((optProps) => {
        const objSchema = `z.object({\n${i}  ...${baseVarName}.shape,\n${i}  ${optProps.join(`,\n${i}  `)},\n${i}})`;
        return ctx.options.loose ? `zloosen(${objSchema})` : objSchema;
      });

      const unionSchema = `z.union([\n${i}${unionMembers.join(`,\n${i}`)},\n${indent(ctx.indent)}])`;

      // Return as union with combined props in each option
      const combinedOptionProps = nestedUnion.unionOptionProps.map(
        (optProps) => [...props, ...optProps],
      );
      return {
        props: [],
        isUnion: true,
        schema: unionSchema,
        unionOptionProps: combinedOptionProps,
      };
    }
    // No base props, just return the union as-is
    const unionMembers = nestedUnion.unionOptionProps.map((optProps) => {
      const objSchema = `z.object({\n${i}  ${optProps.join(`,\n${i}  `)},\n${i}})`;
      return ctx.options.loose ? `zloosen(${objSchema})` : objSchema;
    });

    const unionSchema = `z.union([\n${i}${unionMembers.join(`,\n${i}`)},\n${indent(ctx.indent)}])`;
    return {
      props: [],
      isUnion: true,
      schema: unionSchema,
      unionOptionProps: nestedUnion.unionOptionProps,
    };
  }

  return { props, isUnion: false, schema: '' };
};

/**
 * Generate module for an element declaration
 */
const generateElementModule = (
  elem: ElementDeclIR,
  ctx: EmitContext,
): GeneratedModule => {
  const identifier = qnameToIdentifier(elem.name, ctx);
  const prefix = ctx.prefixMap.get(elem.name.namespace) || 'ns';
  const fileName = qnameToFileName(elem.name, ctx);
  const brandString = getBrandString(elem.name, ctx);

  // Create a new context for this element to track dependencies and local vars
  const elemCtx: EmitContext = {
    ...ctx,
    currentElement: elem.name,
    dependencies: new Set(),
    indent: 0,
    localVars: [],
    localVarCounter: 0,
  };

  let typeSchema: string;

  if (elem.type) {
    if ('namespace' in elem.type && 'localName' in elem.type) {
      typeSchema = emitTypeRef(elem.type as QName, elemCtx);
    } else if ('kind' in elem.type && !('contentModel' in elem.type)) {
      typeSchema = emitSimpleType(elem.type as SimpleTypeIR, elemCtx);
    } else if ('contentModel' in elem.type || 'attributes' in elem.type) {
      typeSchema = emitComplexTypeBody(elem.type as ComplexTypeIR, elemCtx);
    } else {
      typeSchema = 'z.unknown()';
    }
  } else {
    typeSchema = 'z.string()';
  }

  // Generate imports for dependencies
  const imports: string[] = [`import { z } from 'zod';`];

  // Add zloosen import if loose mode is enabled
  if (ctx.options.loose) {
    imports.push(`import { zloosen } from '../helpers/zod/loosen.js';`);
  }

  for (const depKey of elemCtx.dependencies) {
    // Check if it's a type dependency (prefixed with "type:")
    if (depKey.startsWith('type:')) {
      const typeKey = depKey.slice(5); // Remove "type:" prefix
      const depIdentifier = ctx.typeIdentifiers.get(typeKey);
      const depFileName = ctx.typeFileNames.get(typeKey);
      if (depIdentifier && depFileName) {
        imports.push(
          `import { ${depIdentifier} } from '../types/${depFileName}.js';`,
        );
      }
    } else {
      // Element dependency
      const depIdentifier = ctx.elementIdentifiers.get(depKey);
      const depFileName = ctx.elementFileNames.get(depKey);
      if (depIdentifier && depFileName) {
        imports.push(`import { ${depIdentifier} } from './${depFileName}.js';`);
      }
    }
  }

  // Build local vars section if any
  const localVarsSection =
    elemCtx.localVars.length > 0 ? `\n${elemCtx.localVars.join('\n\n')}\n` : '';

  // Apply branding if enabled (default: true)
  const shouldBrand = ctx.options.brand !== false;
  const schemaExport = shouldBrand
    ? `${typeSchema}.brand<${JSON.stringify(brandString)}>()`
    : typeSchema;

  const content = `/**
 * Layer-1 XML JSON schema for <${prefix}:${elem.name.localName}>.
 * Auto-generated from XSD. Do not edit manually.
 */
${imports.join('\n')}
${localVarsSection}
export const ${identifier} = ${schemaExport};

export type ${identifier} = z.infer<typeof ${identifier}>;
`;

  return {
    fileName,
    content,
    qname: elem.name,
    kind: 'element',
    dependencies: elemCtx.dependencies,
  };
};

/**
 * Generate module for a complex type
 */
const generateTypeModule = (
  ct: ComplexTypeIR,
  ctx: EmitContext,
): GeneratedModule => {
  const identifier = qnameToIdentifier(ct.name, ctx);
  const prefix = ctx.prefixMap.get(ct.name.namespace) || 'ns';
  const fileName = qnameToFileName(ct.name, ctx);
  const brandString = getBrandString(ct.name, ctx);

  // Create a new context for this type to track dependencies and local vars
  const typeCtx: EmitContext = {
    ...ctx,
    currentType: ct.name,
    dependencies: new Set(),
    indent: 0,
    localVars: [],
    localVarCounter: 0,
  };

  const typeSchema = emitComplexTypeBody(ct, typeCtx);

  // Generate imports for dependencies
  const imports: string[] = [`import { z } from 'zod';`];

  // Add zloosen import if loose mode is enabled
  if (ctx.options.loose) {
    imports.push(`import { zloosen } from '../helpers/zod/loosen.js';`);
  }

  for (const depKey of typeCtx.dependencies) {
    // Check if it's a type dependency (prefixed with "type:")
    if (depKey.startsWith('type:')) {
      const typeKey = depKey.slice(5); // Remove "type:" prefix
      const depIdentifier = ctx.typeIdentifiers.get(typeKey);
      const depFileName = ctx.typeFileNames.get(typeKey);
      if (depIdentifier && depFileName) {
        imports.push(`import { ${depIdentifier} } from './${depFileName}.js';`);
      }
    } else {
      // Element dependency
      const depIdentifier = ctx.elementIdentifiers.get(depKey);
      const depFileName = ctx.elementFileNames.get(depKey);
      if (depIdentifier && depFileName) {
        imports.push(
          `import { ${depIdentifier} } from '../elements/${depFileName}.js';`,
        );
      }
    }
  }

  // Build local vars section if any
  const localVarsSection =
    typeCtx.localVars.length > 0 ? `\n${typeCtx.localVars.join('\n\n')}\n` : '';

  // Apply branding if enabled (default: true)
  const shouldBrand = ctx.options.brand !== false;
  const schemaExport = shouldBrand
    ? `${typeSchema}.brand<${JSON.stringify(brandString)}>()`
    : typeSchema;

  const content = `/**
 * Layer-1 XML JSON schema for type ${prefix}:${ct.name.localName}.
 * Auto-generated from XSD. Do not edit manually.
 */
${imports.join('\n')}
${localVarsSection}
export const ${identifier} = ${schemaExport};

export type ${identifier} = z.infer<typeof ${identifier}>;
`;

  return {
    fileName,
    content,
    qname: ct.name,
    kind: 'type',
    dependencies: typeCtx.dependencies,
  };
};

/**
 * Generate schema-meta.ts content
 */
const generateSchemaMeta = (
  packName: string,
  elements: GeneratedModule[],
  types: GeneratedModule[],
  singularNodes: SingularNodeInfo[],
  nodesWithAttributes: NodeWithAttributesInfo[],
  ctx: EmitContext,
): string => {
  const namespaces = Array.from(ctx.prefixMap.entries())
    .map(
      ([ns, prefix]) =>
        `  { namespace: ${JSON.stringify(ns)}, prefix: ${JSON.stringify(prefix)} }`,
    )
    .join(',\n');

  const rootElements = elements
    .map(
      (el) =>
        `  { namespace: ${JSON.stringify(el.qname.namespace)}, localName: ${JSON.stringify(el.qname.localName)} }`,
    )
    .join(',\n');

  // Generate singularNodes data
  const singularNodesData = singularNodes
    .map((sn) => {
      if (sn.parentPaths && sn.parentPaths.length > 0) {
        return `  { nodeName: ${JSON.stringify(sn.nodeName)}, parentPaths: [${sn.parentPaths.map((p) => JSON.stringify(p)).join(', ')}] }`;
      }
      return `  { nodeName: ${JSON.stringify(sn.nodeName)} }`;
    })
    .join(',\n');

  // Generate nodesWithAttributes data
  const nodesWithAttributesData = nodesWithAttributes
    .map((na) => {
      if (na.parentPaths && na.parentPaths.length > 0) {
        return `  { nodeName: ${JSON.stringify(na.nodeName)}, parentPaths: [${na.parentPaths.map((p) => JSON.stringify(p)).join(', ')}] }`;
      }
      return `  { nodeName: ${JSON.stringify(na.nodeName)} }`;
    })
    .join(',\n');

  return `/**
 * Schema metadata for pack "${packName}".
 * Auto-generated from XSD. Do not edit manually.
 */

export const schemaPackName = ${JSON.stringify(packName)};

export const namespaces = [
${namespaces}
] as const;

export interface QName {
  namespace: string;
  localName: string;
}

export const rootElements: QName[] = [
${rootElements}
];

/**
 * Information about nodes that are singular (maxOccurs=1) in certain contexts.
 * Used by isSingularNode() predicate for XML parsing array disambiguation.
 */
export interface SingularNodeInfo {
  /** Prefixed node name (e.g., "domain:name") */
  nodeName: string;
  /** Parent paths where this node is singular. If undefined, always singular. */
  parentPaths?: string[];
}

export const singularNodes: SingularNodeInfo[] = [
${singularNodesData}
];

// Build a lookup map for efficient singular node checking
const singularNodeMap = new Map<string, Set<string>>();
for (const sn of singularNodes) {
  if (sn.parentPaths && sn.parentPaths.length > 0) {
    singularNodeMap.set(sn.nodeName, new Set(sn.parentPaths));
  }
}

/**
 * Check if a node is singular (should not be wrapped in array) at the given jpath.
 *
 * @param nodeName - The prefixed node name (e.g., "epp:command")
 * @param jpath - The full jpath from fast-xml-parser (e.g., "epp:epp.epp:command")
 * @returns true if the node is singular, false if it should be an array
 *
 * @example
 * // Configure fast-xml-parser with this predicate
 * const parser = new XMLParser({
 *   isArray: (name, jpath) => !isSingularNode(name, jpath)
 * });
 */
export const isSingularNode = (nodeName: string, jpath: string): boolean => {
  const entry = singularNodeMap.get(nodeName);
  if (!entry) {
    // Not in singular list - treat as array
    return false;
  }

  // Extract parent path from jpath by removing the last segment (nodeName)
  // jpath format: "epp:epp.epp:command" -> parent is "epp:epp"
  const lastDotIndex = jpath.lastIndexOf('.');
  const parentPath = lastDotIndex > 0 ? jpath.substring(0, lastDotIndex) : '';

  // Check if the parentPath matches any of the singular paths
  return entry.has(parentPath);
};

/**
 * Information about nodes that have attributes defined in the XSD.
 * Used by doesNodeHaveAttributes() predicate for XML parsing value handling.
 */
export interface NodeWithAttributesInfo {
  /** Prefixed node name (e.g., "domain:name") */
  nodeName: string;
  /** Parent paths where this node has attributes. If undefined, always has attributes. */
  parentPaths?: string[];
}

export const nodesWithAttributes: NodeWithAttributesInfo[] = [
${nodesWithAttributesData}
];

// Build a lookup map for efficient attribute checking
const nodesWithAttributesMap = new Map<string, Set<string>>();
for (const na of nodesWithAttributes) {
  if (na.parentPaths && na.parentPaths.length > 0) {
    nodesWithAttributesMap.set(na.nodeName, new Set(na.parentPaths));
  }
}

/**
 * Check if a node has attributes defined in the XSD at the given jpath.
 *
 * This is useful for configuring XML parsers to know when to expect an object
 * vs a simple string value for text-only elements.
 *
 * @param nodeName - The prefixed node name (e.g., "domain:name")
 * @param jpath - The full jpath from fast-xml-parser (e.g., "epp:epp.domain:name")
 * @returns true if the node has attributes defined, false otherwise
 *
 * @example
 * // Use with fast-xml-parser configuration
 * // When doesNodeHaveAttributes returns true, expect: { "#text": "value", "@_attr": "..." }
 * // When it returns false, expect just: "value"
 */
export const doesNodeHaveAttributes = (nodeName: string, jpath: string): boolean => {
  const entry = nodesWithAttributesMap.get(nodeName);
  if (!entry) {
    // Not in the list - no attributes defined
    return false;
  }

  // Extract parent path from jpath by removing the last segment (nodeName)
  // jpath format: "epp:epp.domain:name" -> parent is "epp:epp"
  const lastDotIndex = jpath.lastIndexOf('.');
  const parentPath = lastDotIndex > 0 ? jpath.substring(0, lastDotIndex) : '';

  // Check if the parentPath matches any of the paths where this node has attributes
  return entry.has(parentPath);
};
`;
};

/**
 * Generate index.ts content
 */
const generateIndex = (
  elements: GeneratedModule[],
  types: GeneratedModule[],
): string => {
  const elementExports = elements
    .map((el) => `export * from './elements/${el.fileName}.js';`)
    .join('\n');

  const typeExports =
    types.length > 0
      ? types.map((t) => `export * from './types/${t.fileName}.js';`).join('\n')
      : '';

  return `/**
 * Auto-generated Zod schemas for XML validation.
 * Do not edit manually.
 */

export * from './schema-meta.js';

// Element schemas
${elementExports}
${typeExports ? `\n// Type schemas\n${typeExports}` : ''}
`;
};

/**
 * Topological sort for dependency ordering
 */
const topologicalSort = (modules: GeneratedModule[]): GeneratedModule[] => {
  const moduleMap = new Map<string, GeneratedModule>();
  const visited = new Set<string>();
  const result: GeneratedModule[] = [];

  for (const mod of modules) {
    moduleMap.set(qNameKey(mod.qname), mod);
  }

  const visit = (key: string) => {
    if (visited.has(key)) return;
    visited.add(key);

    const mod = moduleMap.get(key);
    if (!mod) return;

    // Visit dependencies first
    for (const dep of mod.dependencies) {
      // Strip "type:" prefix if present for lookup
      const depKey = dep.startsWith('type:') ? dep.slice(5) : dep;
      visit(depKey);
    }

    result.push(mod);
  };

  for (const mod of modules) {
    visit(qNameKey(mod.qname));
  }

  return result;
};

/**
 * Context for walking the schema graph to find singular paths
 */
interface SingularPathWalkContext {
  graph: SchemaGraph;
  prefixMap: Map<NamespaceURI, string>;
  /** Current element path (dot-separated like fast-xml-parser jpath) */
  currentPath: string[];
  /** Map of nodeName -> Set of full parent paths where it's singular */
  singularPaths: Map<string, Set<string>>;
  /** Track visited types to avoid infinite recursion */
  visitedTypes: Set<string>;
}

/**
 * Get prefixed name for an element (for jpath matching)
 */
const getElementPrefixedName = (
  qname: QName,
  prefixMap: Map<NamespaceURI, string>,
): string => {
  const prefix = prefixMap.get(qname.namespace);
  return prefix ? `${prefix}:${qname.localName}` : qname.localName;
};

/**
 * Walk a complex type to find singular element paths
 */
const walkComplexTypeForSingularPaths = (
  ct: ComplexTypeIR,
  ctx: SingularPathWalkContext,
): void => {
  // Prevent infinite recursion on recursive types
  const typeKey = qNameKey(ct.name);
  if (ctx.visitedTypes.has(typeKey)) {
    return;
  }
  ctx.visitedTypes.add(typeKey);

  // Walk the content model
  if (ct.contentModel) {
    walkParticleForSingularPaths(ct.contentModel, ctx);
  }

  // Remove from visited so we can visit again from different paths
  ctx.visitedTypes.delete(typeKey);
};

/**
 * Walk a particle to find singular element paths
 */
const walkParticleForSingularPaths = (
  particle: ParticleIR,
  ctx: SingularPathWalkContext,
): void => {
  if (particle.kind === 'element') {
    walkElementParticleForSingularPaths(particle as ElementParticleIR, ctx);
  } else if (particle.kind === 'group') {
    const group = particle as ModelGroupParticleIR;
    for (const child of group.particles) {
      walkParticleForSingularPaths(child, ctx);
    }
  }
  // 'any' particles are skipped
};

/**
 * Walk an element particle to find singular paths
 */
const walkElementParticleForSingularPaths = (
  particle: ElementParticleIR,
  ctx: SingularPathWalkContext,
): void => {
  // Determine element name and type
  let elemName: QName | undefined;
  let elemType: QName | ComplexTypeIR | SimpleTypeIR | undefined;

  if (particle.ref) {
    const elem = ctx.graph.elements.get(qNameKey(particle.ref));
    if (elem) {
      elemName = elem.name;
      elemType = elem.type;
    }
  } else if (particle.name) {
    elemName = particle.name;
    elemType = particle.type;
  }

  if (!elemName) return;

  const nodeName = getElementPrefixedName(elemName, ctx.prefixMap);
  const { min, max } = particle.occurs;

  // Check if singular (maxOccurs = 1)
  if (max === 1) {
    // Record the full parent path where this element is singular
    const parentPath = ctx.currentPath.join('.');
    if (!ctx.singularPaths.has(nodeName)) {
      ctx.singularPaths.set(nodeName, new Set());
    }
    ctx.singularPaths.get(nodeName)!.add(parentPath);
  }

  // Recurse into element's type if it's a complex type
  if (elemType) {
    // Push this element onto the path
    ctx.currentPath.push(nodeName);

    let complexType: ComplexTypeIR | undefined;

    if ('contentModel' in elemType || 'attributes' in elemType) {
      // Inline complex type
      complexType = elemType as ComplexTypeIR;
    } else if ('namespace' in elemType && 'localName' in elemType) {
      // Reference to a named type
      const resolved = resolveType(elemType as QName, ctx.graph);
      if (
        resolved &&
        ('contentModel' in resolved || 'attributes' in resolved)
      ) {
        complexType = resolved as ComplexTypeIR;
      }
    }

    if (complexType) {
      walkComplexTypeForSingularPaths(complexType, ctx);
    }

    // Pop this element from the path
    ctx.currentPath.pop();
  }
};

/**
 * Build a map of singular node paths by walking the entire schema graph
 */
const buildSingularPathsMap = (
  graph: SchemaGraph,
  prefixMap: Map<NamespaceURI, string>,
): Map<string, Set<string>> => {
  const singularPaths = new Map<string, Set<string>>();

  // Walk from each root element
  for (const elem of graph.elements.values()) {
    const rootName = getElementPrefixedName(elem.name, prefixMap);

    const ctx: SingularPathWalkContext = {
      graph,
      prefixMap,
      currentPath: [rootName],
      singularPaths,
      visitedTypes: new Set(),
    };

    // Walk the element's type
    if (elem.type) {
      let complexType: ComplexTypeIR | undefined;

      if ('contentModel' in elem.type || 'attributes' in elem.type) {
        complexType = elem.type as ComplexTypeIR;
      } else if ('namespace' in elem.type && 'localName' in elem.type) {
        const resolved = resolveType(elem.type as QName, graph);
        if (
          resolved &&
          ('contentModel' in resolved || 'attributes' in resolved)
        ) {
          complexType = resolved as ComplexTypeIR;
        }
      }

      if (complexType) {
        walkComplexTypeForSingularPaths(complexType, ctx);
      }
    }
  }

  return singularPaths;
};

/**
 * Context for walking the schema graph to find nodes with attributes
 */
interface NodesWithAttributesWalkContext {
  graph: SchemaGraph;
  prefixMap: Map<NamespaceURI, string>;
  /** Current element path (dot-separated like fast-xml-parser jpath) */
  currentPath: string[];
  /** Map of nodeName -> Set of full parent paths where it has attributes */
  nodesWithAttributes: Map<string, Set<string>>;
  /** Track visited types to avoid infinite recursion */
  visitedTypes: Set<string>;
}

/**
 * Check if a type has attributes defined
 */
const typeHasAttributes = (
  elemType: QName | ComplexTypeIR | SimpleTypeIR | undefined,
  graph: SchemaGraph,
): boolean => {
  if (!elemType) return false;

  if ('attributes' in elemType) {
    // Inline complex type
    const ct = elemType as ComplexTypeIR;
    return ct.attributes && ct.attributes.length > 0;
  }
  if ('namespace' in elemType && 'localName' in elemType) {
    // Reference to a named type
    const resolved = resolveType(elemType as QName, graph);
    if (resolved && 'attributes' in resolved) {
      return resolved.attributes && resolved.attributes.length > 0;
    }
  }

  return false;
};

/**
 * Walk a complex type to find nodes with attributes
 */
const walkComplexTypeForNodesWithAttributes = (
  ct: ComplexTypeIR,
  ctx: NodesWithAttributesWalkContext,
): void => {
  // Prevent infinite recursion on recursive types
  const typeKey = qNameKey(ct.name);
  if (ctx.visitedTypes.has(typeKey)) {
    return;
  }
  ctx.visitedTypes.add(typeKey);

  // Walk the content model
  if (ct.contentModel) {
    walkParticleForNodesWithAttributes(ct.contentModel, ctx);
  }

  // Remove from visited so we can visit again from different paths
  ctx.visitedTypes.delete(typeKey);
};

/**
 * Walk a particle to find nodes with attributes
 */
const walkParticleForNodesWithAttributes = (
  particle: ParticleIR,
  ctx: NodesWithAttributesWalkContext,
): void => {
  if (particle.kind === 'element') {
    walkElementParticleForNodesWithAttributes(
      particle as ElementParticleIR,
      ctx,
    );
  } else if (particle.kind === 'group') {
    const group = particle as ModelGroupParticleIR;
    for (const child of group.particles) {
      walkParticleForNodesWithAttributes(child, ctx);
    }
  }
  // 'any' particles are skipped
};

/**
 * Walk an element particle to find nodes with attributes
 */
const walkElementParticleForNodesWithAttributes = (
  particle: ElementParticleIR,
  ctx: NodesWithAttributesWalkContext,
): void => {
  // Determine element name and type
  let elemName: QName | undefined;
  let elemType: QName | ComplexTypeIR | SimpleTypeIR | undefined;

  if (particle.ref) {
    const elem = ctx.graph.elements.get(qNameKey(particle.ref));
    if (elem) {
      elemName = elem.name;
      elemType = elem.type;
    }
  } else if (particle.name) {
    elemName = particle.name;
    elemType = particle.type;
  }

  if (!elemName) return;

  const nodeName = getElementPrefixedName(elemName, ctx.prefixMap);

  // Check if this element's type has attributes
  if (typeHasAttributes(elemType, ctx.graph)) {
    // Record the full parent path where this element has attributes
    const parentPath = ctx.currentPath.join('.');
    if (!ctx.nodesWithAttributes.has(nodeName)) {
      ctx.nodesWithAttributes.set(nodeName, new Set());
    }
    ctx.nodesWithAttributes.get(nodeName)!.add(parentPath);
  }

  // Recurse into element's type if it's a complex type
  if (elemType) {
    // Push this element onto the path
    ctx.currentPath.push(nodeName);

    let complexType: ComplexTypeIR | undefined;

    if ('contentModel' in elemType || 'attributes' in elemType) {
      // Inline complex type
      complexType = elemType as ComplexTypeIR;
    } else if ('namespace' in elemType && 'localName' in elemType) {
      // Reference to a named type
      const resolved = resolveType(elemType as QName, ctx.graph);
      if (
        resolved &&
        ('contentModel' in resolved || 'attributes' in resolved)
      ) {
        complexType = resolved as ComplexTypeIR;
      }
    }

    if (complexType) {
      walkComplexTypeForNodesWithAttributes(complexType, ctx);
    }

    // Pop this element from the path
    ctx.currentPath.pop();
  }
};

/**
 * Build a map of nodes with attributes by walking the entire schema graph
 */
const buildNodesWithAttributesMap = (
  graph: SchemaGraph,
  prefixMap: Map<NamespaceURI, string>,
): Map<string, Set<string>> => {
  const nodesWithAttributes = new Map<string, Set<string>>();

  // Walk from each root element
  for (const elem of graph.elements.values()) {
    const rootName = getElementPrefixedName(elem.name, prefixMap);

    const ctx: NodesWithAttributesWalkContext = {
      graph,
      prefixMap,
      currentPath: [rootName],
      nodesWithAttributes,
      visitedTypes: new Set(),
    };

    // Check if root element itself has attributes
    if (typeHasAttributes(elem.type, graph)) {
      // Root element has no parent, use empty string
      if (!nodesWithAttributes.has(rootName)) {
        nodesWithAttributes.set(rootName, new Set());
      }
      nodesWithAttributes.get(rootName)!.add('');
    }

    // Walk the element's type
    if (elem.type) {
      let complexType: ComplexTypeIR | undefined;

      if ('contentModel' in elem.type || 'attributes' in elem.type) {
        complexType = elem.type as ComplexTypeIR;
      } else if ('namespace' in elem.type && 'localName' in elem.type) {
        const resolved = resolveType(elem.type as QName, graph);
        if (
          resolved &&
          ('contentModel' in resolved || 'attributes' in resolved)
        ) {
          complexType = resolved as ComplexTypeIR;
        }
      }

      if (complexType) {
        walkComplexTypeForNodesWithAttributes(complexType, ctx);
      }
    }
  }

  return nodesWithAttributes;
};

/**
 * Generate all code for a schema pack
 */
export const generateFromSchemaGraph = (
  graph: SchemaGraph,
  options: CodegenOptions = {},
): CodegenResult => {
  const prefixMap = buildPrefixMap(graph.namespaces, options.namespacePrefix);

  // Pre-compute identifiers and file names for all elements and types
  const elementIdentifiers = new Map<string, string>();
  const elementFileNames = new Map<string, string>();
  const typeIdentifiers = new Map<string, string>();
  const typeFileNames = new Map<string, string>();

  const baseCtx: Omit<
    EmitContext,
    'dependencies' | 'currentElement' | 'currentType'
  > = {
    graph,
    options: {
      useNamespacePrefixes: true,
      ...options,
    },
    prefixMap,
    indent: 0,
    elementIdentifiers,
    elementFileNames,
    typeIdentifiers,
    typeFileNames,
    localVars: [],
    localVarCounter: 0,
  };

  // First pass: collect all element identifiers
  for (const elem of graph.elements.values()) {
    const key = qNameKey(elem.name);
    elementIdentifiers.set(
      key,
      qnameToIdentifier(elem.name, baseCtx as EmitContext),
    );
    elementFileNames.set(
      key,
      qnameToFileName(elem.name, baseCtx as EmitContext),
    );
  }

  // Collect all named complex type identifiers (skip anonymous types)
  for (const ct of graph.complexTypes.values()) {
    if (!ct.name.localName.includes('__')) {
      const key = qNameKey(ct.name);
      typeIdentifiers.set(
        key,
        qnameToIdentifier(ct.name, baseCtx as EmitContext),
      );
      typeFileNames.set(key, qnameToFileName(ct.name, baseCtx as EmitContext));
    }
  }

  const ctx: EmitContext = {
    ...baseCtx,
    dependencies: new Set(),
  };

  // Generate type modules first (they are dependencies for elements)
  let types: GeneratedModule[] = [];
  for (const ct of graph.complexTypes.values()) {
    // Skip anonymous types
    if (!ct.name.localName.includes('__')) {
      types.push(generateTypeModule(ct, ctx));
    }
  }
  types = topologicalSort(types);

  // Generate element modules
  let elements: GeneratedModule[] = [];
  for (const elem of graph.elements.values()) {
    elements.push(generateElementModule(elem, ctx));
  }

  // Sort by dependencies
  elements = topologicalSort(elements);

  // Build singular paths map using dedicated graph walker (not alwaysArray mode)
  const singularPathsMap = options.alwaysArray
    ? new Map<string, Set<string>>()
    : buildSingularPathsMap(graph, prefixMap);

  // Convert singularPaths Map to array
  const singularNodesInfo: SingularNodeInfo[] = [];
  for (const [nodeName, parentPaths] of singularPathsMap) {
    singularNodesInfo.push({
      nodeName,
      parentPaths: parentPaths.size > 0 ? Array.from(parentPaths) : undefined,
    });
  }

  // Build nodes with attributes map
  const nodesWithAttributesMap = buildNodesWithAttributesMap(graph, prefixMap);

  // Convert nodesWithAttributes Map to array
  const nodesWithAttributesInfo: NodeWithAttributesInfo[] = [];
  for (const [nodeName, parentPaths] of nodesWithAttributesMap) {
    nodesWithAttributesInfo.push({
      nodeName,
      parentPaths: parentPaths.size > 0 ? Array.from(parentPaths) : undefined,
    });
  }

  // Generate metadata and index
  const schemaMeta = generateSchemaMeta(
    graph.name,
    elements,
    types,
    singularNodesInfo,
    nodesWithAttributesInfo,
    ctx,
  );
  const index = generateIndex(elements, types);

  return {
    elements,
    types,
    schemaMeta,
    index,
    singularNodes: singularNodesInfo,
    nodesWithAttributes: nodesWithAttributesInfo,
    loose: options.loose ?? false,
  };
};
