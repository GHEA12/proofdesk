// Pure parsing helpers shared by the Jira clients (real and fake).
//
// ProofDesk reads structured data out of ordinary Jira issues, so the
// formats are deliberately simple, human-writable plain text blocks that
// live in the issue description:
//
//   ProofDesk claim
//   Type: vendor-delivery
//   Amount: 1250.00
//   Currency: USD
//   Vendor: Acme Logistics
//   Invoice: INV-2026-001
//   PO: PO-1001
//
//   ProofDesk purchase order
//   Reference: PO-1001
//   Amount: 1250.00
//   Currency: USD
//   Vendor: Acme Logistics
//
// Everything in this module is a pure function of its input: no Forge
// imports, no network, fully unit-testable offline.

/** Extract the plain text of an Atlassian Document Format (ADF) value. */
export function adfToText(adf) {
  if (adf == null) return '';
  if (typeof adf === 'string') return adf;
  const parts = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      parts.push('\n');
      return;
    }
    const blockTypes = new Set([
      'paragraph',
      'heading',
      'listItem',
      'tableCell',
      'tableHeader',
      'codeBlock',
      'blockquote',
    ]);
    const isBlock = blockTypes.has(node.type);
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
    if (isBlock) parts.push('\n');
  };
  walk(adf);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function parseKeyValueBlock(text, headingPattern) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) return null;
  const fields = {};
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (Object.keys(fields).length > 0) break;
      continue;
    }
    const match = line.match(/^([A-Za-z][A-Za-z ]*):\s*(.+)$/);
    if (!match) break;
    fields[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return fields;
}

function parseAmount(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the "ProofDesk claim" block of an issue description into the raw
 * claim shape the engine consumes (issueKey is injected by the caller).
 * Returns null when the issue carries no claim block.
 */
export function parseClaimBlock(text) {
  const fields = parseKeyValueBlock(text, /proofdesk\s+claim/i);
  if (!fields) return null;
  return {
    claimType: fields.type ?? '',
    amount: parseAmount(fields.amount),
    currency: fields.currency ?? '',
    vendor: fields.vendor ?? '',
    invoiceNumber: fields.invoice ?? '',
    poReference: fields.po ?? null,
  };
}

/**
 * Parse a "ProofDesk purchase order" block into the raw PO record shape
 * the engine consumes. Returns null when there is no PO block.
 */
export function parsePoBlock(text) {
  const fields = parseKeyValueBlock(text, /proofdesk\s+purchase\s+order/i);
  if (!fields) return null;
  return {
    reference: fields.reference ?? '',
    amount: parseAmount(fields.amount),
    currency: fields.currency ?? '',
    vendor: fields.vendor ?? '',
  };
}

/**
 * Classify an attachment into an engine evidence type from its file
 * name. The convention is documented for judges: name evidence files so
 * the type is visible (for example "INV-2026-001-invoice.txt" or
 * "DN-2026-001-delivery-note.json"). Anything unrecognized is 'other'
 * and never satisfies a requirement.
 */
export function classifyEvidenceFile(filename) {
  const name = String(filename ?? '').toLowerCase();
  if (name.includes('delivery')) return 'delivery-note';
  if (name.includes('invoice')) return 'invoice';
  if (name.includes('sign-off') || name.includes('signoff')) return 'sign-off';
  if (name.includes('receipt')) return 'receipt';
  return 'other';
}

/**
 * Convert the plain-text-with-light-markdown comment produced by
 * src/comment.js into an ADF document for the Jira comment API.
 * Supports the exact constructs the formatter emits: **bold** and `code`
 * inline marks, "- " bullet lines (grouped into one bullet list), and
 * blank-line paragraph breaks. Deterministic and unit-testable.
 */
export function textToAdf(text) {
  const content = [];
  let listItems = null;
  const flushList = () => {
    if (listItems) {
      content.push({ type: 'bulletList', content: listItems });
      listItems = null;
    }
  };
  const paragraph = (line) => ({ type: 'paragraph', content: parseInline(line) });
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith('- ')) {
      if (!listItems) listItems = [];
      listItems.push({ type: 'listItem', content: [paragraph(line.slice(2).trim())] });
      continue;
    }
    if (line.startsWith('  - ')) {
      // Sub-bullets are flattened into the current list item's paragraph
      // flow as their own list item; the comment stays readable in Jira.
      if (!listItems) listItems = [];
      listItems.push({ type: 'listItem', content: [paragraph(line.slice(4).trim())] });
      continue;
    }
    flushList();
    if (line.trim() === '') continue;
    content.push(paragraph(line.trim()));
  }
  flushList();
  if (content.length === 0) content.push({ type: 'paragraph', content: [] });
  return { type: 'doc', version: 1, content };
}

function parseInline(line) {
  const nodes = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: line.slice(lastIndex, match.index) });
    }
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push({ type: 'text', text: token.slice(2, -2), marks: [{ type: 'strong' }] });
    } else {
      nodes.push({ type: 'text', text: token.slice(1, -1), marks: [{ type: 'code' }] });
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < line.length) {
    nodes.push({ type: 'text', text: line.slice(lastIndex) });
  }
  return nodes;
}
