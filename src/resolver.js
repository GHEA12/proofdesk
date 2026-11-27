// ProofDesk app service + Forge resolver definitions.
//
// createProofDeskService holds all app logic above the engine: it reads
// the claim issue through the Jira client interface, downloads the real
// attachment bytes, runs the check engine, stores the hash-chained
// receipt in the registry, and (for panel-initiated runs) posts the
// verdict comment back to the issue. The issue panel, the ledger page,
// and the Rovo actions are all thin wrappers over this service, so every
// surface reports the same verdicts.
//
// createResolver maps the service onto the function keys the frontend
// invokes: getPanelState, runVerification, getReceipt, listReceipts,
// verifyChain. src/index.js wires these into @forge/resolver for the
// Forge runtime; tests call them directly.

import { runVerification, verifyChain } from './engine/index.js';
import { formatReceiptComment } from './comment.js';

/**
 * @param {object} deps
 * @param {object} deps.jira     Jira client (src/jira-client.js interface).
 * @param {object} deps.registry Receipt registry (engine registry interface).
 * @param {Function} [deps.now]  Clock returning an ISO timestamp string;
 *                               injected for deterministic tests.
 */
export function createProofDeskService({ jira, registry, now } = {}) {
  if (!jira) throw new TypeError('createProofDeskService needs a jira client');
  if (!registry) throw new TypeError('createProofDeskService needs a registry');
  const clock = typeof now === 'function' ? now : () => new Date().toISOString();

  async function loadClaimInputs(issueKey) {
    const issue = await jira.getClaimIssue(issueKey);
    const poRecord = issue.claim.poReference
      ? await jira.getPurchaseOrder(issue.claim.poReference, issue.linkedIssueKeys)
      : null;
    const evidenceFiles = [];
    for (const attachment of issue.attachments) {
      const bytes = await jira.getAttachmentBytes(attachment.id);
      evidenceFiles.push({ name: attachment.filename, type: attachment.type, bytes });
    }
    return { issue, poRecord, evidenceFiles };
  }

  return {
    /**
     * Everything the issue panel renders before any button is pressed:
     * the claim, the evidence set, the latest receipt (if any), and the
     * chain status.
     */
    async getPanelState(issueKey) {
      const issue = await jira.getClaimIssue(issueKey);
      const receipts = await registry.getAll();
      const chain = verifyChain(receipts);
      const latestReceipt = [...receipts].reverse().find((r) => r.issueKey === issueKey) ?? null;
      return {
        issueKey,
        summary: issue.summary,
        claim: issue.claim,
        evidence: issue.attachments.map((a) => ({
          id: a.id,
          name: a.filename,
          type: a.type,
          mimeType: a.mimeType,
        })),
        latestReceipt,
        chainValid: chain.valid,
        receiptCount: receipts.length,
      };
    },

    /**
     * Run the check battery for an issue and store the receipt.
     * `postComment` posts the verdict comment to the issue (panel runs);
     * Rovo action runs pass false — the agent reports in chat instead.
     * Returns { verdict, checks, receipt, commentId }.
     */
    async runVerificationForIssue(issueKey, { postComment = true } = {}) {
      const { issue, poRecord, evidenceFiles } = await loadClaimInputs(issueKey);
      const { verdict, checks, receipt } = await runVerification({
        claim: issue.claim,
        poRecord,
        evidenceFiles,
        registry,
        now: clock(),
      });
      let commentId = null;
      if (postComment) {
        const posted = await jira.postVerdictComment(issueKey, formatReceiptComment(receipt));
        commentId = posted?.commentId ?? null;
      }
      return { verdict, checks, receipt, commentId };
    },

    /** The latest receipt stored for an issue, or null. */
    async getLatestReceipt(issueKey) {
      const receipts = await registry.getAll();
      return [...receipts].reverse().find((r) => r.issueKey === issueKey) ?? null;
    },

    /** The ledger view: every receipt in chain order, plus chain status. */
    async listReceipts() {
      const receipts = await registry.getAll();
      return { receipts, chain: verifyChain(receipts) };
    },

    /** Re-validate the whole receipt chain end to end. */
    async verifyChainStatus() {
      return verifyChain(await registry.getAll());
    },
  };
}

/**
 * Map the service onto Forge resolver function keys. Returns
 * { definitions, resolve } where definitions maps each key to an async
 * function taking the invoke payload.
 */
export function createResolver(deps) {
  const service = createProofDeskService(deps);
  const definitions = {
    getPanelState: async (payload = {}) => {
      requireIssueKey(payload);
      return service.getPanelState(payload.issueKey);
    },
    runVerification: async (payload = {}) => {
      requireIssueKey(payload);
      return service.runVerificationForIssue(payload.issueKey, { postComment: true });
    },
    getReceipt: async (payload = {}) => {
      requireIssueKey(payload);
      return service.getLatestReceipt(payload.issueKey);
    },
    listReceipts: async () => service.listReceipts(),
    verifyChain: async () => service.verifyChainStatus(),
  };
  return {
    service,
    definitions,
    async resolve(functionKey, payload) {
      const fn = definitions[functionKey];
      if (!fn) throw new Error(`Unknown ProofDesk resolver function: ${functionKey}`);
      return fn(payload ?? {});
    },
  };
}

function requireIssueKey(payload) {
  if (!payload || typeof payload.issueKey !== 'string' || payload.issueKey.trim() === '') {
    throw new Error('This ProofDesk function needs an issueKey payload');
  }
}
