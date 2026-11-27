// Claim / purchase-order data model for the ProofDesk check engine.
//
// A claim is the structured snapshot of a Jira approval issue: what is
// being claimed (amount, currency, vendor, invoice number) and which
// purchase order backs it. Evidence files arrive separately as
// { name, type, bytes } records; the engine hashes the real bytes.
//
// Amounts are compared in integer minor units (cents) so floating point
// never leaks into a verdict.

export const CLAIM_TYPES = {
  VENDOR_DELIVERY: 'vendor-delivery',
  EXPENSE: 'expense',
  CONTRACTOR_MILESTONE: 'contractor-milestone',
};

/**
 * Required evidence per claim type. `evidenceTypes` are evidence-file
 * types that must be attached; `requiresPO` means the claim must carry a
 * purchase-order reference that resolves to a PO record.
 */
export const REQUIRED_EVIDENCE = {
  'vendor-delivery': { evidenceTypes: ['invoice', 'delivery-note'], requiresPO: true },
  expense: { evidenceTypes: ['receipt'], requiresPO: false },
  'contractor-milestone': { evidenceTypes: ['invoice', 'sign-off'], requiresPO: true },
};

export const VERDICTS = {
  VERIFIED: 'VERIFIED',
  NEEDS_EVIDENCE: 'NEEDS EVIDENCE',
  MISMATCH: 'MISMATCH',
};

export function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function fromCents(cents) {
  return cents === null || cents === undefined ? null : cents / 100;
}

/** Normalize a raw claim into the shape the checks consume. */
export function normalizeClaim(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('claim must be an object');
  return {
    issueKey: String(raw.issueKey ?? ''),
    claimType: String(raw.claimType ?? ''),
    amountCents: toCents(raw.amount),
    currency: String(raw.currency ?? '').toUpperCase(),
    vendor: String(raw.vendor ?? ''),
    invoiceNumber: String(raw.invoiceNumber ?? ''),
    poReference: raw.poReference ? String(raw.poReference) : null,
  };
}

/** Normalize a raw purchase-order record. */
export function normalizePO(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('PO record must be an object');
  return {
    reference: String(raw.reference ?? ''),
    amountCents: toCents(raw.amount),
    currency: String(raw.currency ?? '').toUpperCase(),
    vendor: String(raw.vendor ?? ''),
  };
}

/**
 * Parse a machine-readable evidence file (a JSON delivery note) into
 * { noteNumber, poReference, currency, totalCents, lineItems } where each
 * line item is { description, quantity, unitPriceCents, totalCents }.
 * Returns null when the bytes are not a JSON delivery note — the app
 * does not OCR paper documents (stated limitation, see PLAN.md).
 */
export function parseDeliveryNote(evidenceFile) {
  if (!evidenceFile || evidenceFile.type !== 'delivery-note') return null;
  let text;
  try {
    text = Buffer.from(evidenceFile.bytes).toString('utf8');
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.lineItems)) {
    return null;
  }
  return {
    noteNumber: parsed.noteNumber ? String(parsed.noteNumber) : null,
    poReference: parsed.poReference ? String(parsed.poReference) : null,
    currency: parsed.currency ? String(parsed.currency).toUpperCase() : null,
    totalCents: toCents(parsed.total),
    lineItems: parsed.lineItems.map((item) => ({
      description: String(item?.description ?? ''),
      quantity: Number(item?.quantity),
      unitPriceCents: toCents(item?.unitPrice),
      totalCents: toCents(item?.total),
    })),
  };
}
