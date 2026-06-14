/**
 * Conflict Scanner
 *
 * Analyzes SchemaGraph to detect potential namespace conflicts
 * and suggests field name mappings to avoid them.
 */

import type {
  SchemaGraph,
  ComplexTypeIR,
  ParticleIR,
  ElementParticleIR,
  QName,
} from '../xml-schema-graph-ir.js';
import { qNameKey } from '../xml-schema-graph-ir.js';

/**
 * A detected conflict: same local name, different namespaces.
 */
export interface ConflictInfo {
  /** The local name that has conflicts */
  localName: string;
  /** All elements with this local name (different namespaces) */
  elements: QName[];
  /** The parent type where this conflict occurs */
  parentType: QName;
  /** True if elements are inside a <choice> (mutually exclusive, not a real runtime conflict) */
  isChoiceAlternative: boolean;
}

/**
 * An element collected from the content model with compositor context.
 */
interface CollectedElement {
  qname: QName;
  /** True if this element is inside a choice group */
  inChoice: boolean;
}

/**
 * Suggested mapping to resolve a conflict.
 */
export interface SuggestedMapping {
  /** The namespace-qualified key: {namespace}localName */
  qualifiedKey: string;
  /** The suggested field name */
  suggestedName: string;
  /** The original QName for reference */
  qname: QName;
}

/**
 * Result of scanning for conflicts.
 */
export interface ScanResult {
  /** All detected conflicts */
  conflicts: ConflictInfo[];
  /** Suggested fieldNameMapping to resolve all conflicts */
  suggestedMappings: Record<string, string>;
  /** Detailed mapping info for programmatic use */
  mappingDetails: SuggestedMapping[];
}

/**
 * Options for the conflict scanner.
 */
export interface ScanOptions {
  /**
   * Custom namespace aliases for generating suggested names.
   * Maps namespace URI to short alias (e.g., "urn:...domain-1.0" -> "domain")
   */
  namespaceAliases?: Map<string, string>;
}

/**
 * Scan a SchemaGraph for namespace conflicts and suggest mappings.
 */
export const scanConflicts = (
  graph: SchemaGraph,
  options: ScanOptions = {},
): ScanResult => {
  const conflicts: ConflictInfo[] = [];
  const mappingDetails: SuggestedMapping[] = [];

  // Scan all complex types
  for (const [_key, complexType] of graph.complexTypes) {
    const typeConflicts = scanComplexType(complexType, graph);
    conflicts.push(...typeConflicts);
  }

  // Scan all global elements (their inline types)
  for (const [_key, element] of graph.elements) {
    if (
      element.type &&
      typeof element.type === 'object' &&
      'contentModel' in element.type
    ) {
      const typeConflicts = scanComplexType(
        element.type as ComplexTypeIR,
        graph,
      );
      conflicts.push(...typeConflicts);
    }
  }

  // Deduplicate conflicts (same conflict might appear multiple times)
  const uniqueConflicts = deduplicateConflicts(conflicts);

  // Generate suggested mappings
  for (const conflict of uniqueConflicts) {
    const suggestions = generateSuggestions(conflict, options.namespaceAliases);
    mappingDetails.push(...suggestions);
  }

  // Build the final mapping record
  const suggestedMappings: Record<string, string> = {};
  for (const mapping of mappingDetails) {
    suggestedMappings[mapping.qualifiedKey] = mapping.suggestedName;
  }

  return {
    conflicts: uniqueConflicts,
    suggestedMappings,
    mappingDetails,
  };
};

/**
 * Scan a complex type for conflicts among its child elements.
 */
const scanComplexType = (
  complexType: ComplexTypeIR,
  graph: SchemaGraph,
): ConflictInfo[] => {
  if (!complexType.contentModel) {
    return [];
  }

  // Collect all child elements from the content model (with choice context)
  const childElements = collectChildElements(complexType.contentModel, graph);

  // Group by local name, tracking both QName and choice context
  const byLocalName = new Map<string, CollectedElement[]>();
  for (const elem of childElements) {
    const existing = byLocalName.get(elem.qname.localName) || [];
    // Check if this exact QName is already in the list
    if (
      !existing.some(
        (e) =>
          e.qname.namespace === elem.qname.namespace &&
          e.qname.localName === elem.qname.localName,
      )
    ) {
      existing.push(elem);
    }
    byLocalName.set(elem.qname.localName, existing);
  }

  // Find conflicts (same local name, multiple namespaces)
  const conflicts: ConflictInfo[] = [];
  for (const [localName, elements] of byLocalName) {
    // Get unique namespaces
    const uniqueNamespaces = new Set(elements.map((e) => e.qname.namespace));
    if (uniqueNamespaces.size > 1) {
      // Check if ALL conflicting elements are in a choice (mutually exclusive)
      const allInChoice = elements.every((e) => e.inChoice);

      conflicts.push({
        localName,
        elements: elements.map((e) => e.qname),
        parentType: complexType.name,
        isChoiceAlternative: allInChoice,
      });
    }
  }

  return conflicts;
};

/**
 * Recursively collect all child element QNames from a particle.
 * Tracks whether elements are inside a choice group.
 */
const collectChildElements = (
  particle: ParticleIR,
  graph: SchemaGraph,
  inChoice = false,
): CollectedElement[] => {
  const elements: CollectedElement[] = [];

  if (particle.kind === 'element') {
    const elemParticle = particle as ElementParticleIR;
    if (elemParticle.ref) {
      elements.push({ qname: elemParticle.ref, inChoice });
    } else if (elemParticle.name) {
      elements.push({ qname: elemParticle.name, inChoice });
    }
  } else if (particle.kind === 'group') {
    // Check if this group is a choice
    const isChoice = particle.compositor === 'choice';
    // Recurse into group particles, propagating choice context
    for (const child of particle.particles) {
      elements.push(
        ...collectChildElements(child, graph, inChoice || isChoice),
      );
    }
  }
  // 'any' particles don't contribute specific element names

  return elements;
};

/**
 * Deduplicate conflicts by parent type and local name.
 */
const deduplicateConflicts = (conflicts: ConflictInfo[]): ConflictInfo[] => {
  const seen = new Map<string, ConflictInfo>();

  for (const conflict of conflicts) {
    const key = `${qNameKey(conflict.parentType)}|${conflict.localName}`;
    if (!seen.has(key)) {
      seen.set(key, conflict);
    }
  }

  return [...seen.values()];
};

/**
 * Generate suggested field name mappings for a conflict.
 */
const generateSuggestions = (
  conflict: ConflictInfo,
  namespaceAliases?: Map<string, string>,
): SuggestedMapping[] => {
  const suggestions: SuggestedMapping[] = [];

  for (const qname of conflict.elements) {
    const alias = getNamespaceAlias(qname.namespace, namespaceAliases);
    const suggestedName = camelCase(`${alias}_${qname.localName}`);
    const qualifiedKey = `{${qname.namespace}}${qname.localName}`;

    suggestions.push({
      qualifiedKey,
      suggestedName,
      qname,
    });
  }

  return suggestions;
};

/**
 * Get a short alias for a namespace URI.
 */
const getNamespaceAlias = (
  namespace: string,
  customAliases?: Map<string, string>,
): string => {
  // Check custom aliases first
  if (customAliases?.has(namespace)) {
    return customAliases.get(namespace)!;
  }

  // Infer from namespace URI
  return inferNamespaceAlias(namespace);
};

/**
 * Infer a short alias from a namespace URI.
 */
const inferNamespaceAlias = (namespace: string): string => {
  // Try to extract meaningful part from the URI
  // Common patterns: urn:ietf:params:xml:ns:domain-1.0, http://example.com/domain

  // Extract last path/URN segment
  const parts = namespace.split(/[/:#]/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part && part.length > 0) {
      // Remove version suffix and clean up
      const cleaned = part
        .replace(/-[\d.]+$/, '') // Remove version like -1.0
        .replace(/[^a-zA-Z0-9]/g, '');
      if (cleaned.length > 0) {
        return cleaned.toLowerCase();
      }
    }
  }

  return 'ns';
};

/**
 * Convert a string to camelCase.
 */
const camelCase = (str: string): string => {
  return str
    .split(/[_\-\s]+/)
    .map((word, index) => {
      if (index === 0) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('');
};

/**
 * Format scan results as a human-readable report.
 */
export const formatScanReport = (result: ScanResult): string => {
  const lines: string[] = [];

  if (result.conflicts.length === 0) {
    lines.push('No namespace conflicts detected.');
    return lines.join('\n');
  }

  // Separate real conflicts from choice alternatives
  const realConflicts = result.conflicts.filter((c) => !c.isChoiceAlternative);
  const choiceAlternatives = result.conflicts.filter(
    (c) => c.isChoiceAlternative,
  );

  if (realConflicts.length > 0) {
    lines.push(
      `Found ${realConflicts.length} real conflict(s) (elements can co-exist):\n`,
    );

    for (const conflict of realConflicts) {
      lines.push(`Conflict in type "${conflict.parentType.localName}":`);
      lines.push(
        `  Local name "${conflict.localName}" appears in multiple namespaces:`,
      );
      for (const elem of conflict.elements) {
        lines.push(`    - ${elem.namespace}`);
      }
      lines.push('');
    }
  }

  if (choiceAlternatives.length > 0) {
    lines.push(
      `Found ${choiceAlternatives.length} choice alternative(s) (mutually exclusive, informational):\n`,
    );

    for (const conflict of choiceAlternatives) {
      lines.push(`Choice in type "${conflict.parentType.localName}":`);
      lines.push(
        `  Local name "${conflict.localName}" has alternatives in namespaces:`,
      );
      for (const elem of conflict.elements) {
        lines.push(`    - ${elem.namespace}`);
      }
      lines.push('');
    }
  }

  // Only suggest mappings for real conflicts
  const realMappings = result.mappingDetails.filter((m) =>
    realConflicts.some((c) =>
      c.elements.some(
        (e) =>
          e.namespace === m.qname.namespace &&
          e.localName === m.qname.localName,
      ),
    ),
  );

  if (realMappings.length > 0) {
    lines.push('Suggested fieldNameMapping for real conflicts:');
    lines.push('```typescript');
    lines.push('{');
    for (const mapping of realMappings) {
      lines.push(`  "${mapping.qualifiedKey}": "${mapping.suggestedName}",`);
    }
    lines.push('}');
    lines.push('```');
  } else if (realConflicts.length === 0) {
    lines.push(
      'No fieldNameMapping needed - all conflicts are choice alternatives.',
    );
  }

  return lines.join('\n');
};
