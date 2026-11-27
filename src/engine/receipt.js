// Hash-chained receipts. Every verification run produces a receipt: a
// snapshot of the claim, the SHA-256 hash of every evidence file, the
// per-check results, and the verdict. The receipt's own hash covers all
// of that plus the previous receipt's hash, so the registry forms a
// tamper-evident chain (the ListGuard / ClaimCheck receipts pattern).

import { sha256Hex, canonicalStringify } from './hash.js';
import { fromCents } from './model.js';

/** The public claim snapshot stored inside a receipt. */
export function snapshotClaim(claim) {
  return {
    issueKey: claim.issueKey,
    claimType: claim.claimType,
    amount: fromCents(claim.amountCents),
    currency: claim.currency,
    vendor: claim.vendor,
    invoiceNumber: claim.invoiceNumber,
    poReference: claim.poReference,
  };
}

/**
 * Build a receipt. `prevHash` is the hash of the previous receipt in the
 * chain (null for the first receipt). `timestamp` is injected by the
 * caller so tests and demo runs are deterministic.
 */
export function buildReceipt({ claim, evidence, checks, verdict, prevHash, timestamp }) {
  const body = {
    version: 1,
    issueKey: claim.issueKey,
    timestamp,
    claim: snapshotClaim(claim),
    evidence: (evidence ?? []).map((f) => ({ name: f.name, type: f.type, sha256: f.sha256 })),
    checks: (checks ?? []).map((c) => ({ id: c.id, label: c.label, status: c.status, details: c.details })),
    verdict,
    prevHash: prevHash ?? null,
  };
  const hash = sha256Hex(canonicalStringify(body));
  return { id: 'pd_' + hash.slice(0, 16), ...body, hash };
}

/** Recompute a receipt's hash from its stored body. */
export function computeReceiptHash(receipt) {
  const { id, hash, ...body } = receipt;
  return sha256Hex(canonicalStringify(body));
}

/**
 * Verify a chain of receipts in order: the first receipt must have a
 * null prevHash, every later receipt must link to the previous hash, and
 * every stored hash must recompute exactly. Returns
 * { valid, checked, firstInvalidIndex, details }.
 */
export function verifyChain(receipts) {
  const details = [];
  let expectedPrev = null;
  for (let i = 0; i < receipts.length; i += 1) {
    const receipt = receipts[i];
    if (receipt.prevHash !== expectedPrev) {
      details.push(
        `Receipt ${receipt.id} (index ${i}) links to prevHash ${receipt.prevHash} but the previous receipt hash is ${expectedPrev}.`,
      );
      return { valid: false, checked: i + 1, firstInvalidIndex: i, details };
    }
    const recomputed = computeReceiptHash(receipt);
    if (recomputed !== receipt.hash) {
      details.push(
        `Receipt ${receipt.id} (index ${i}) hash mismatch: stored ${receipt.hash}, recomputed ${recomputed}. The receipt was altered after it was written.`,
      );
      return { valid: false, checked: i + 1, firstInvalidIndex: i, details };
    }
    expectedPrev = receipt.hash;
  }
  details.push(`Chain verified end to end: ${receipts.length} receipt(s), all hashes and links intact.`);
  return { valid: true, checked: receipts.length, firstInvalidIndex: null, details };
}

/** Render a receipt as plain text lines for the Jira verdict comment. */
export function renderReceiptComment(receipt) {
  const lines = [];
  lines.push(`ProofDesk receipt ${receipt.id}`);
  lines.push(`Verdict: ${receipt.verdict}`);
  lines.push(
    `Claim: ${receipt.claim.amount} ${receipt.claim.currency} from ${receipt.claim.vendor} (invoice ${receipt.claim.invoiceNumber}) on ${receipt.issueKey}.`,
  );
  lines.push('Checks:');
  for (const check of receipt.checks) {
    lines.push(`- ${check.label}: ${check.status.toUpperCase()}`);
    for (const detail of check.details) {
      lines.push(`  - ${detail}`);
    }
  }
  lines.push('Evidence (SHA-256):');
  for (const file of receipt.evidence) {
    lines.push(`- ${file.name} [${file.type}] ${file.sha256}`);
  }
  lines.push(`Receipt hash: ${receipt.hash}`);
  lines.push(`Previous receipt hash: ${receipt.prevHash ?? '(none, first receipt in chain)'}`);
  return lines.join('\n');
}
