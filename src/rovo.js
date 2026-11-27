// Rovo action handlers for the ProofDesk Verifier agent (manifest.yml:
// rovo.verifyEvidence and rovo.getReceipt).
//
// Both actions wrap the same ProofDesk service the issue panel uses, so
// the agent reports exactly the verdicts the panel produces. One
// deliberate difference: action runs do NOT post the verdict comment to
// the issue — the receipt is stored and chained, and the agent reports
// the result in the Rovo conversation (the manifest action description
// promises exactly that). Panel runs post the comment.
//
// The exported verifyEvidence / getReceipt functions are the production
// handlers Forge invokes; they wrap handlers built synchronously over
// production dependencies from src/forge-api.js. Tests use
// createRovoHandlers with fakes instead.

import { createProofDeskService } from './resolver.js';
import { createProductionDeps } from './forge-api.js';

/**
 * Build the two action handlers over injected dependencies.
 * Handlers take the action payload ({ issueKey }) and return plain
 * JSON-serializable results for the agent to report.
 */
export function createRovoHandlers(deps) {
    const service = createProofDeskService(deps);
    return {
          /** rovo:action verify-evidence (CREATE). */
          async verifyEvidence(payload = {}) {
                  const issueKey = requireIssueKey(payload);
                  const { verdict, checks, receipt } = await service.runVerificationForIssue(issueKey, {
                            postComment: false,
                  });
                  return {
                            issueKey,
                            verdict,
                            receiptId: receipt.id,
                            receiptHash: receipt.hash,
                            previousReceiptHash: receipt.prevHash,
                            checks: receipt.checks,
                            evidence: receipt.evidence,
                            commentPosted: false,
                  };
          },

          /** rovo:action get-receipt (GET). */
          async getReceipt(payload = {}) {
                  const issueKey = requireIssueKey(payload);
                  const receipt = await service.getLatestReceipt(issueKey);
                  if (!receipt) {
                            return {
                                        issueKey,
                                        found: false,
                                        message: `Issue ${issueKey} has not been verified by ProofDesk yet.`,
                            };
                  }
                  return { issueKey, found: true, receipt };
          },
    };
}

function requireIssueKey(payload) {
    if (!payload || typeof payload.issueKey !== 'string' || payload.issueKey.trim() === '') {
          throw new Error('This ProofDesk action needs an issueKey input');
    }
    return payload.issueKey;
}

// --- Production handlers -------------------------------------------------
// Built synchronously at module load. An earlier version built them
// lazily behind a dynamic import() of ./forge-api.js — the same defect
// that hung the resolver handler in the deployed bundle (see
// src/index.js and ../EVIDENCE.md, "Panel hang fix", 2026-11-27).

const productionHandlers = createRovoHandlers(createProductionDeps());

export async function verifyEvidence(payload) {
    return productionHandlers.verifyEvidence(payload);
}

export async function getReceipt(payload) {
    return productionHandlers.getReceipt(payload);
}
