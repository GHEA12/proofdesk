// ProofDesk check engine — public surface.
// Pure, locally testable modules: no Forge imports, no network, no LLM.

export { sha256Hex, canonicalStringify } from './hash.js';
export {
  CLAIM_TYPES,
  REQUIRED_EVIDENCE,
  VERDICTS,
  toCents,
  fromCents,
  normalizeClaim,
  normalizePO,
  parseDeliveryNote,
} from './model.js';
export { checkCompleteness, checkAmountConsistency, checkDuplicate } from './checks.js';
export { buildReceipt, computeReceiptHash, verifyChain, snapshotClaim, renderReceiptComment } from './receipt.js';
export { InMemoryRegistry } from './registry.js';
export { runVerification } from './verify.js';
