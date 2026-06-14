/**
 * Loader module - Exports XSD parsing and SchemaGraph building functionality
 */

export {
  parseXsdContent,
  extractDirectives,
  extractTargetNamespace,
  type SchemaDirective,
} from './xsd-parser.js';

export {
  createSchemaLoader,
  buildSchemaGraph,
  resolveType,
  resolveElement,
  isBuiltInType,
  getElements,
  getComplexTypes,
  getSimpleTypes,
} from './schema-graph-builder.js';
