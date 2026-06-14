/**
 * SchemaGraph IR for XML Schema (XSD) → Zod codegen
 *
 * This file defines a protocol-agnostic intermediate representation (IR)
 * used by the code generator. The loader/parser builds this IR from a
 * set of XSD files (a SchemaPack). The codegen then traverses the IR
 * to emit TypeScript/Zod schemas.
 */

export type NamespaceURI = string;

/**
 * Qualified Name: namespace + localName.
 */
export interface QName {
  namespace: NamespaceURI;
  localName: string;
}

/**
 * Occurrence constraints (minOccurs/maxOccurs).
 * maxOccurs = "unbounded" is represented as Infinity.
 */
export interface Occurs {
  min: number; // default 1
  max: number; // default 1 or Infinity
}

/**
 * Simple type kind.
 * We start simple; more facets can be added incrementally.
 */
export type SimpleTypeKind =
  | 'string'
  | 'boolean'
  | 'decimal'
  | 'integer'
  | 'dateTime'
  | 'date'
  | 'time'
  | 'anySimpleType';

/**
 * Representation of an XSD simpleType.
 */
export interface SimpleTypeIR {
  name: QName; // can be anonymous; namespace + localName
  base?: QName; // base simple type (if restriction/extension)
  kind: SimpleTypeKind; // inferred primitive type
  enumeration?: string[]; // xs:enumeration
  pattern?: string; // xs:pattern (single; multiple patterns can be merged)
  minInclusive?: string; // numeric or lexical, not interpreted here
  maxInclusive?: string;
  minLength?: number;
  maxLength?: number;
}

/**
 * Attribute use (required/optional/prohibited).
 */
export type AttributeUse = 'optional' | 'required' | 'prohibited';

/**
 * Representation of an XSD attribute.
 */
export interface AttributeIR {
  name: QName; // attribute name (no prefix)
  type: QName | SimpleTypeIR; // can be named or inline simpleType
  use: AttributeUse; // required / optional
  defaultValue?: string;
  fixedValue?: string;
}

/**
 * Model compositor type: sequence, choice, all.
 */
export type ModelCompositor = 'sequence' | 'choice' | 'all';

/**
 * Element particle (child in a model group).
 */
export interface ElementParticleIR {
  kind: 'element';
  ref?: QName; // if it references a global element
  name?: QName; // if it's a local element definition
  type?: QName | ComplexTypeIR | SimpleTypeIR;
  occurs: Occurs;
}

/**
 * Model group particle (sequence/choice/all).
 */
export interface ModelGroupParticleIR {
  kind: 'group';
  compositor: ModelCompositor;
  occurs: Occurs;
  particles: ParticleIR[];
}

/**
 * Wildcard (<xs:any>) particle – for extensibility.
 */
export interface AnyParticleIR {
  kind: 'any';
  occurs: Occurs;
  namespace?: string; // e.g. "##other", "##any", or explicit URI
}

/**
 * A particle can be an element, a model group, or a wildcard.
 */
export type ParticleIR =
  | ElementParticleIR
  | ModelGroupParticleIR
  | AnyParticleIR;

/**
 * Representation of an XSD complexType.
 */
export interface ComplexTypeIR {
  name: QName; // global or anonymous (localName may be synthetic)
  base?: QName; // base type (for extension/restriction)
  isAbstract?: boolean;

  /**
   * Content model is expressed as a single root ParticleIR
   * (e.g., sequence/choice/all) or undefined for empty content.
   */
  contentModel?: ParticleIR;

  /**
   * Attributes directly declared on this type (does NOT include inherited).
   */
  attributes: AttributeIR[];

  /**
   * Whether this type allows mixed content (text + elements).
   */
  mixed?: boolean;
}

/**
 * Representation of a global element declaration.
 */
export interface ElementDeclIR {
  name: QName; // element name
  type?: QName | ComplexTypeIR | SimpleTypeIR;
  /**
   * If the element has an anonymous complexType/simpleType,
   * 'type' will be that inline type; otherwise it references a named type.
   */
  nillable?: boolean;
  substitutionGroup?: QName; // for substitution groups
}

/**
 * Group/type of schema component.
 */
export type SchemaComponent = SimpleTypeIR | ComplexTypeIR | ElementDeclIR;

/**
 * A single XSD schema's IR contribution (before includes/imports/redefines are merged).
 * In practice, most consumers will work with SchemaGraph, not this.
 */
export interface RawSchemaIR {
  targetNamespace?: NamespaceURI;
  /** Namespace prefixes from xmlns declarations: URI -> prefix */
  namespacePrefixes: Map<string, string>;
  simpleTypes: SimpleTypeIR[];
  complexTypes: ComplexTypeIR[];
  elements: ElementDeclIR[];
  // Potential extension points: attributeGroups, modelGroups, etc.
}

/**
 * Final, compiled schema graph for a SchemaPack.
 * This is after resolving:
 *  - includes
 *  - imports
 *  - redefines (so that each QName has a single effective definition)
 */
export interface SchemaGraph {
  /**
   * Logical name of the pack, for human reference and logging.
   */
  name: string;

  /**
   * All namespaces used in the pack (targetNamespaces, plus any imported).
   */
  namespaces: NamespaceURI[];

  /**
   * Namespace to prefix mappings extracted from xmlns declarations.
   * Maps namespace URI -> prefix (e.g., "urn:ietf:params:xml:ns:domain-1.0" -> "domain")
   */
  namespacePrefixes: Map<string, string>;

  /**
   * Simple types indexed by QName (final definitions).
   */
  simpleTypes: Map<string, SimpleTypeIR>; // key: QNameKey

  /**
   * Complex types indexed by QName (final definitions).
   */
  complexTypes: Map<string, ComplexTypeIR>; // key: QNameKey

  /**
   * Global element declarations indexed by QName.
   */
  elements: Map<string, ElementDeclIR>; // key: QNameKey
}

/**
 * Utility: create a stable string key from a QName.
 * This is used as the Map key for SchemaGraph maps.
 */
export function qNameKey(q: QName): string {
  return `{${q.namespace}}${q.localName}`;
}

/**
 * Options passed to the SchemaPack loader.
 */
export interface SchemaPackLoadOptions {
  name: string; // pack name
  files: string[]; // paths to XSD files
  rootNamespaces?: NamespaceURI[]; // optional filter
  namespaceAliases?: Map<string, string>; // URI → prefix overrides
}

/**
 * High-level tasks expected from the loader:
 *
 * - Parse all XSDs.
 * - Build RawSchemaIR per physical schema.
 * - Resolve includes/imports/redefines.
 * - Merge into a single SchemaGraph with one definition per QName.
 */
export interface SchemaLoader {
  loadPack(options: SchemaPackLoadOptions): Promise<SchemaGraph>;
}
