// The ProofDesk check battery. Every check is deterministic code over
// the claim snapshot, the linked PO record, the evidence bytes, and the
// receipt registry. No LLM is involved anywhere in a verdict.
//
// Each check returns { id, label, status, details } where status is
// 'pass', 'fail', or 'skipped' (the check had nothing to compare).

import { REQUIRED_EVIDENCE, fromCents, parseDeliveryNote } from './model.js';

function result(id, label, status, details) {
  return { id, label, status, details };
}

/**
 * Evidence completeness: every required evidence type for the claim type
 * is attached, and a PO reference is present when the claim type needs
 * one.
 */
export function checkCompleteness(claim, evidenceFiles) {
  const label = 'Evidence completeness';
  const requirement = REQUIRED_EVIDENCE[claim.claimType];
  if (!requirement) {
    return result('completeness', label, 'fail', [
      `Unknown claim type "${claim.claimType}"; cannot determine required evidence.`,
    ]);
  }
  const presentTypes = new Set((evidenceFiles ?? []).map((f) => f.type));
  const details = [];
  const missing = [];
  for (const type of requirement.evidenceTypes) {
    if (presentTypes.has(type)) {
      details.push(`Evidence present: ${type}.`);
    } else {
      missing.push(type);
      details.push(`Evidence missing: ${type}.`);
    }
  }
  if (requirement.requiresPO) {
    if (claim.poReference) {
      details.push(`PO reference present: ${claim.poReference}.`);
    } else {
      missing.push('po-reference');
      details.push('PO reference missing: this claim type requires a linked purchase order.');
    }
  }
  return result('completeness', label, missing.length === 0 ? 'pass' : 'fail', details);
}

/**
 * Amount consistency: the claimed amount and currency are cross-checked
 * against the linked PO record, and the line-item arithmetic of a
 * machine-readable delivery note is verified for real (each line total
 * equals quantity x unit price, the lines sum to the note total, and the
 * note total and PO reference agree with the claim).
 */
export function checkAmountConsistency(claim, poRecord, evidenceFiles) {
  const label = 'Amount consistency';
  const details = [];
  let failures = 0;
  let comparisons = 0;

  if (poRecord) {
    comparisons += 1;
    if (claim.currency !== poRecord.currency) {
      failures += 1;
      details.push(
        `Currency mismatch: claim is ${claim.currency || '(blank)'} but PO ${poRecord.reference} is ${poRecord.currency || '(blank)'}.`,
      );
    } else {
      details.push(`Currency matches PO ${poRecord.reference}: ${claim.currency}.`);
    }
    comparisons += 1;
    if (claim.amountCents !== poRecord.amountCents) {
      failures += 1;
      details.push(
        `Amount mismatch: claim is ${fromCents(claim.amountCents)} ${claim.currency} but PO ${poRecord.reference} is ${fromCents(poRecord.amountCents)} ${poRecord.currency}.`,
      );
    } else {
      details.push(
        `Amount matches PO ${poRecord.reference}: ${fromCents(claim.amountCents)} ${claim.currency}.`,
      );
    }
    if (
      claim.vendor &&
      poRecord.vendor &&
      claim.vendor.trim().toLowerCase() !== poRecord.vendor.trim().toLowerCase()
    ) {
      comparisons += 1;
      failures += 1;
      details.push(
        `Vendor mismatch: claim names "${claim.vendor}" but PO ${poRecord.reference} names "${poRecord.vendor}".`,
      );
    }
  }

  const noteFile = (evidenceFiles ?? []).find((f) => f.type === 'delivery-note');
  const note = noteFile ? parseDeliveryNote(noteFile) : null;
  if (note) {
    let lineSumCents = 0;
    note.lineItems.forEach((item, index) => {
      comparisons += 1;
      const expected = Math.round(item.quantity * (item.unitPriceCents ?? 0));
      if (item.totalCents !== expected) {
        failures += 1;
        details.push(
          `Delivery note line ${index + 1} arithmetic error: ${item.quantity} x ${fromCents(item.unitPriceCents)} = ${fromCents(expected)}, but the line total says ${fromCents(item.totalCents)}.`,
        );
      }
      lineSumCents += item.totalCents ?? 0;
    });
    comparisons += 1;
    if (lineSumCents !== note.totalCents) {
      failures += 1;
      details.push(
        `Delivery note total mismatch: line items sum to ${fromCents(lineSumCents)} but the note total says ${fromCents(note.totalCents)}.`,
      );
    } else {
      details.push(`Delivery note line items sum to the note total: ${fromCents(note.totalCents)}.`);
    }
    comparisons += 1;
    if (note.totalCents !== claim.amountCents) {
      failures += 1;
      details.push(
        `Delivery note total ${fromCents(note.totalCents)} does not match the claimed amount ${fromCents(claim.amountCents)}.`,
      );
    } else {
      details.push('Delivery note total matches the claimed amount.');
    }
    if (note.poReference && claim.poReference && note.poReference !== claim.poReference) {
      comparisons += 1;
      failures += 1;
      details.push(
        `Delivery note references PO ${note.poReference} but the claim references PO ${claim.poReference}.`,
      );
    }
    if (note.currency && note.currency !== claim.currency) {
      comparisons += 1;
      failures += 1;
      details.push(
        `Delivery note currency ${note.currency} does not match the claim currency ${claim.currency}.`,
      );
    }
  }

  if (comparisons === 0) {
    return result('amount-consistency', label, 'skipped', [
      'No PO record and no machine-readable evidence to cross-check the amount against.',
    ]);
  }
  return result('amount-consistency', label, failures === 0 ? 'pass' : 'fail', details);
}

/**
 * Duplicate detection: the invoice number and the SHA-256 hash of every
 * evidence file are looked up in the site-wide receipt registry. A hit
 * on a *different* issue means the same invoice or file was already
 * receipted elsewhere. Re-running checks on the same issue is not a
 * duplicate.
 *
 * `registry` follows the interface in registry.js (async, KVS-shaped).
 * `evidence` is the hashed evidence list: [{ name, type, sha256 }].
 */
export async function checkDuplicate(claim, evidence, registry) {
  const label = 'Duplicate detection';
  const details = [];
  let failures = 0;

  if (claim.invoiceNumber) {
    const byInvoice = await registry.findByInvoice(claim.invoiceNumber);
    if (byInvoice && byInvoice.issueKey !== claim.issueKey) {
      failures += 1;
      details.push(
        `Duplicate invoice: ${claim.invoiceNumber} was already receipted on ${byInvoice.issueKey} (receipt ${byInvoice.id}).`,
      );
    } else {
      details.push(`Invoice ${claim.invoiceNumber} not previously receipted on another issue.`);
    }
  }

  for (const file of evidence ?? []) {
    const byHash = await registry.findByHash(file.sha256);
    if (byHash && byHash.issueKey !== claim.issueKey) {
      failures += 1;
      details.push(
        `Duplicate evidence file: "${file.name}" (sha256 ${file.sha256.slice(0, 12)}...) was already receipted on ${byHash.issueKey} (receipt ${byHash.id}).`,
      );
    }
  }
  if (failures === 0) {
    details.push('No evidence file matches a receipt on another issue.');
  }
  return result('duplicate', label, failures === 0 ? 'pass' : 'fail', details);
}
