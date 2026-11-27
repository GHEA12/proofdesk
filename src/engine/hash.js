// Hashing and canonical serialization helpers for the ProofDesk engine.
// Pure functions, Node standard library only. No Forge imports, no LLM.

import { createHash } from 'node:crypto';

/**
 * SHA-256 of a string (UTF-8) or byte array (Buffer / Uint8Array),
 * returned as lowercase hex.
 */
export function sha256Hex(data) {
  const hash = createHash('sha256');
  if (typeof data === 'string') {
    hash.update(data, 'utf8');
  } else {
    hash.update(data);
  }
  return hash.digest('hex');
}

/**
 * Deterministic JSON serialization: object keys are sorted recursively,
 * arrays keep their order. Two structurally equal values always produce
 * the same string, which is what makes receipt hashes reproducible.
 */
export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map(
    (key) => JSON.stringify(key) + ':' + canonicalStringify(value[key]),
  );
  return '{' + parts.join(',') + '}';
}
