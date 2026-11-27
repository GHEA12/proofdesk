// The verification orchestrator: run the check battery over one claim,
// derive the verdict, chain a receipt onto the registry, and return
// everything the panel, the verdict comment, and the Rovo actions need.
//
// Verdict precedence (deterministic, documented for the submission):
//   1. Evidence incomplete            -> NEEDS EVIDENCE
//   2. Any other check failed         -> MISMATCH
//      (amount/currency inconsistency, or a duplicate invoice/file)
//   3. Otherwise                      -> VERIFIED

import { normalizeClaim, normalizePO, VERDICTS } from './model.js';
import { sha256Hex } from './hash.js';
import { checkCompleteness, checkAmountConsistency, checkDuplicate } from './checks.js';
import { buildReceipt } from './receipt.js';

/**
 * @param {object} input
 * @param {object} input.claim          Raw claim snapshot (see model.js).
 * @param {object|null} input.poRecord  Raw linked PO record, or null.
 * @param {Array}  input.evidenceFiles  [{ name, type, bytes }].
 * @param {object} input.registry       Registry (see registry.js).
 * @param {string} [input.now]          ISO timestamp; injected for tests.
 * @returns {Promise<{ verdict, checks, receipt }>}
 */
export async function runVerification({ claim, poRecord, evidenceFiles, registry, now }) {
  const normalizedClaim = normalizeClaim(claim);
  const normalizedPO = poRecord ? normalizePO(poRecord) : null;
  const files = evidenceFiles ?? [];
  const evidence = files.map((f) => ({
    name: f.name,
    type: f.type,
    sha256: sha256Hex(f.bytes),
  }));

  const checks = [
    checkCompleteness(normalizedClaim, files),
    checkAmountConsistency(normalizedClaim, normalizedPO, files),
    await checkDuplicate(normalizedClaim, evidence, registry),
  ];

  let verdict = VERDICTS.VERIFIED;
  if (checks[0].status === 'fail') {
    verdict = VERDICTS.NEEDS_EVIDENCE;
  } else if (checks.some((c) => c.status === 'fail')) {
    verdict = VERDICTS.MISMATCH;
  }

  const prevHash = await registry.getChainHead();
  const receipt = buildReceipt({
    claim: normalizedClaim,
    evidence,
    checks,
    verdict,
    prevHash,
    timestamp: now ?? new Date().toISOString(),
  });
  await registry.put(receipt);

  return { verdict, checks, receipt };
}