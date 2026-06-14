/**
 * Analyzer module - static analysis utilities for XSD schemas
 */

export {
  scanConflicts,
  formatScanReport,
  type ConflictInfo,
  type SuggestedMapping,
  type ScanResult,
  type ScanOptions,
} from './conflict-scanner.js';
