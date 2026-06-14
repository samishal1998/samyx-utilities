/**
 * IR-Enhanced Mode
 *
 * Metadata detection using SchemaGraph IR for richer type information.
 * Provides:
 * - Accurate type hints from XSD
 * - Precise cardinality from minOccurs/maxOccurs
 * - Complete namespace information
 */

import type {
  XmlNodeMeta,
  XmlFieldMeta,
  XmlAttributeFieldMeta,
  XmlElementFieldMeta,
  XmlValueMeta,
  QName,
  XmlJsonStrategy,
} from './types.js';
import type {
  SchemaGraph,
  ElementDeclIR,
  ComplexTypeIR,
  SimpleTypeIR,
  ParticleIR,
  ElementParticleIR,
  ModelGroupParticleIR,
  AttributeIR,
  QName as IrqName,
} from '../xml-schema-graph-ir.js';
import { qNameKey } from '../xml-schema-graph-ir.js';
import { detectMetadata } from './detect-metadata.js';
import {
  createFieldNameContext,
  computeSimplifiedName,
} from './field-naming.js';

/**
 * Detect metadata with SchemaGraph enhancement.
 *
 * Uses IR for:
 * - Accurate type hints
 * - Precise cardinality from minOccurs/maxOccurs
 * - Known namespace URIs
 *
 * Falls back to runtime detection if element not found in SchemaGraph.
 */
export const detectMetadataWithIR = (
  xmlNode: unknown,
  elementQName: QName,
  schemaGraph: SchemaGraph,
  strategy: XmlJsonStrategy,
  fieldNameMapping?: Record<string, string>,
  namespaceAliases?: Map<string, string>,
  stripNamespacePrefixes = true,
): XmlNodeMeta => {
  // Convert to IR QName (required namespace)
  const irQName: IrqName = {
    namespace: elementQName.namespace || '',
    localName: elementQName.localName,
  };

  // Look up element in schema
  const elementDecl = resolveElementFromGraph(irQName, schemaGraph);

  if (!elementDecl) {
    // Fall back to runtime detection
    return detectMetadata(xmlNode, {
      strategy,
      schemaGraph,
      knownQName: elementQName,
      parentNamespace: elementQName.namespace,
      fieldNameMapping,
      namespaceAliases,
      stripNamespacePrefixes,
    });
  }

  // Create field name context
  const context = createFieldNameContext(fieldNameMapping, namespaceAliases);

  return buildNodeMetaFromIR(
    elementDecl,
    schemaGraph,
    strategy,
    context,
    stripNamespacePrefixes,
  );
};

/**
 * Resolve element from SchemaGraph by QName.
 */
const resolveElementFromGraph = (
  qname: IrqName,
  graph: SchemaGraph,
): ElementDeclIR | undefined => {
  const key = qNameKey(qname);
  return graph.elements.get(key);
};

/**
 * Resolve type from SchemaGraph by QName.
 */
const resolveTypeFromGraph = (
  qname: IrqName,
  graph: SchemaGraph,
): SimpleTypeIR | ComplexTypeIR | undefined => {
  const key = qNameKey(qname);
  return graph.simpleTypes.get(key) || graph.complexTypes.get(key);
};

/**
 * Check if a QName refers to an XSD built-in type.
 */
const isBuiltInType = (qname: IrqName): boolean => {
  return qname.namespace === 'http://www.w3.org/2001/XMLSchema';
};

/**
 * Build XmlNodeMeta from ElementDeclIR.
 */
const buildNodeMetaFromIR = (
  elementDecl: ElementDeclIR,
  schemaGraph: SchemaGraph,
  strategy: XmlJsonStrategy,
  context: ReturnType<typeof createFieldNameContext>,
  stripNamespacePrefixes: boolean,
): XmlNodeMeta => {
  const fields: Record<string, XmlFieldMeta> = {};
  let valueMeta: XmlValueMeta | undefined;

  // Resolve type
  const type = elementDecl.type;
  if (!type) {
    return {
      qname: toLayer2QName(elementDecl.name),
      fields,
    };
  }

  // If type is a QName reference, resolve it
  if (isQNameType(type)) {
    if (isBuiltInType(type)) {
      // Built-in simple type - this element has text content
      valueMeta = {
        kind: 'value',
        xmlName: '#text',
        cardinality: 'one',
        typeHint: `${type.localName}`,
      };
    } else {
      const resolvedType = resolveTypeFromGraph(type, schemaGraph);
      if (resolvedType) {
        if (isComplexTypeIR(resolvedType)) {
          return buildNodeMetaFromComplexType(
            elementDecl.name,
            resolvedType,
            schemaGraph,
            strategy,
            context,
            stripNamespacePrefixes,
          );
        }
        // SimpleTypeIR - element has text content
        valueMeta = {
          kind: 'value',
          xmlName: '#text',
          cardinality: 'one',
          typeHint: resolvedType.name.localName,
        };
      }
    }
  } else if (isComplexTypeIR(type)) {
    // Inline ComplexTypeIR
    return buildNodeMetaFromComplexType(
      elementDecl.name,
      type,
      schemaGraph,
      strategy,
      context,
      stripNamespacePrefixes,
    );
  } else if (isSimpleTypeIR(type)) {
    // Inline SimpleTypeIR
    valueMeta = {
      kind: 'value',
      xmlName: '#text',
      cardinality: 'one',
      typeHint: type.name.localName,
    };
  }

  return {
    qname: toLayer2QName(elementDecl.name),
    value: valueMeta,
    fields,
  };
};

/**
 * Build XmlNodeMeta from ComplexTypeIR.
 */
const buildNodeMetaFromComplexType = (
  elementName: IrqName,
  ct: ComplexTypeIR,
  schemaGraph: SchemaGraph,
  strategy: XmlJsonStrategy,
  context: ReturnType<typeof createFieldNameContext>,
  stripNamespacePrefixes: boolean,
): XmlNodeMeta => {
  const fields: Record<string, XmlFieldMeta> = {};

  // Process attributes
  for (const attr of ct.attributes) {
    const attrMeta = buildAttributeFieldMeta(
      attr,
      context,
      stripNamespacePrefixes,
    );
    const simplifiedName = computeSimplifiedName(
      attr.name.localName,
      attr.name.namespace || undefined,
      context,
      stripNamespacePrefixes,
    );
    fields[simplifiedName] = attrMeta;
  }

  // Process content model
  if (ct.contentModel) {
    processParticle(
      ct.contentModel,
      fields,
      schemaGraph,
      strategy,
      context,
      stripNamespacePrefixes,
    );
  }

  // Handle mixed content
  const valueMeta: XmlValueMeta | undefined = ct.mixed
    ? { kind: 'value', xmlName: '#text', cardinality: 'one' }
    : undefined;

  return {
    qname: toLayer2QName(elementName),
    value: valueMeta,
    fields,
  };
};

/**
 * Build attribute field metadata from AttributeIR.
 */
const buildAttributeFieldMeta = (
  attr: AttributeIR,
  _context: ReturnType<typeof createFieldNameContext>,
  _stripNamespacePrefixes: boolean,
): XmlAttributeFieldMeta => {
  // Get type hint
  let typeHint: string | undefined;
  if (isQNameType(attr.type)) {
    typeHint = attr.type.localName;
  } else if (isSimpleTypeIR(attr.type)) {
    typeHint = attr.type.name.localName;
  }

  return {
    kind: 'attribute',
    xmlName: attr.name.localName,
    namespace: attr.name.namespace || undefined,
    cardinality: 'one',
    typeHint,
  };
};

/**
 * Process a particle (element, group, any) and add to fields.
 */
const processParticle = (
  particle: ParticleIR,
  fields: Record<string, XmlFieldMeta>,
  schemaGraph: SchemaGraph,
  strategy: XmlJsonStrategy,
  context: ReturnType<typeof createFieldNameContext>,
  stripNamespacePrefixes: boolean,
): void => {
  if (particle.kind === 'element') {
    processElementParticle(
      particle as ElementParticleIR,
      fields,
      schemaGraph,
      strategy,
      context,
      stripNamespacePrefixes,
    );
  } else if (particle.kind === 'group') {
    // Recurse into sequence/choice/all
    const group = particle as ModelGroupParticleIR;
    for (const child of group.particles) {
      processParticle(
        child,
        fields,
        schemaGraph,
        strategy,
        context,
        stripNamespacePrefixes,
      );
    }
  }
  // 'any' particles are skipped - they're for extensibility
};

/**
 * Process an element particle and add to fields.
 */
const processElementParticle = (
  elemParticle: ElementParticleIR,
  fields: Record<string, XmlFieldMeta>,
  schemaGraph: SchemaGraph,
  strategy: XmlJsonStrategy,
  context: ReturnType<typeof createFieldNameContext>,
  stripNamespacePrefixes: boolean,
): void => {
  // Get element name (from ref or inline name)
  const elemName = elemParticle.ref || elemParticle.name;
  if (!elemName) return;

  // Calculate cardinality
  const cardinality =
    elemParticle.occurs.max > 1 ||
    elemParticle.occurs.max === Number.POSITIVE_INFINITY
      ? 'many'
      : 'one';

  // Get simplified name
  const simplifiedName = computeSimplifiedName(
    elemName.localName,
    elemName.namespace || undefined,
    context,
    stripNamespacePrefixes,
  );

  // Build element field meta
  const fieldMeta: XmlElementFieldMeta = {
    kind: 'element',
    xmlName: elemName.localName,
    namespace: elemName.namespace || undefined,
    cardinality,
  };

  // Try to get nested metadata for complex elements
  let nestedMeta: XmlNodeMeta | undefined;

  if (elemParticle.ref) {
    // Referenced element - resolve from schema
    const referencedElem = resolveElementFromGraph(
      elemParticle.ref,
      schemaGraph,
    );
    if (referencedElem) {
      nestedMeta = buildNodeMetaFromIR(
        referencedElem,
        schemaGraph,
        strategy,
        createFieldNameContext(), // Fresh context for nested
        stripNamespacePrefixes,
      );
    }
  } else if (elemParticle.type) {
    // Inline type
    if (isQNameType(elemParticle.type)) {
      if (!isBuiltInType(elemParticle.type)) {
        const resolvedType = resolveTypeFromGraph(
          elemParticle.type,
          schemaGraph,
        );
        if (resolvedType && isComplexTypeIR(resolvedType)) {
          nestedMeta = buildNodeMetaFromComplexType(
            elemName,
            resolvedType,
            schemaGraph,
            strategy,
            createFieldNameContext(),
            stripNamespacePrefixes,
          );
        }
      }
    } else if (isComplexTypeIR(elemParticle.type)) {
      nestedMeta = buildNodeMetaFromComplexType(
        elemName,
        elemParticle.type,
        schemaGraph,
        strategy,
        createFieldNameContext(),
        stripNamespacePrefixes,
      );
    }
  }

  if (nestedMeta && Object.keys(nestedMeta.fields).length > 0) {
    fieldMeta.nodeMeta = nestedMeta;
  }

  // Get type hint
  if (elemParticle.type && isQNameType(elemParticle.type)) {
    fieldMeta.typeHint = elemParticle.type.localName;
  }

  fields[simplifiedName] = fieldMeta;
};

// Type guards

const isQNameType = (type: unknown): type is IrqName => {
  return (
    type !== null &&
    typeof type === 'object' &&
    'namespace' in type &&
    'localName' in type &&
    !('attributes' in type) &&
    !('kind' in type)
  );
};

const isComplexTypeIR = (type: unknown): type is ComplexTypeIR => {
  return (
    type !== null &&
    typeof type === 'object' &&
    'attributes' in type &&
    Array.isArray((type as ComplexTypeIR).attributes)
  );
};

const isSimpleTypeIR = (type: unknown): type is SimpleTypeIR => {
  return (
    type !== null &&
    typeof type === 'object' &&
    'kind' in type &&
    typeof (type as SimpleTypeIR).kind === 'string' &&
    !('attributes' in type)
  );
};

/**
 * Convert IR QName to Layer 2 QName.
 */
const toLayer2QName = (irQName: IrqName): QName => ({
  namespace: irQName.namespace || undefined,
  localName: irQName.localName,
});

/**
 * Get all root elements from SchemaGraph that can be decoded.
 */
export const getRootElements = (schemaGraph: SchemaGraph): QName[] => {
  return Array.from(schemaGraph.elements.values()).map((elem) =>
    toLayer2QName(elem.name),
  );
};

/**
 * Check if an element exists in the SchemaGraph.
 */
export const hasElement = (qname: QName, schemaGraph: SchemaGraph): boolean => {
  const irQName: IrqName = {
    namespace: qname.namespace || '',
    localName: qname.localName,
  };
  return resolveElementFromGraph(irQName, schemaGraph) !== undefined;
};
