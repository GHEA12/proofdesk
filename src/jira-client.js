// The Jira client interface between ProofDesk and Jira, plus the local
// fake implementation used by tests and offline development.
//
// The resolver and the Rovo handlers only ever talk to this interface:
//
//   getClaimIssue(issueKey)
//     -> { issueKey, summary, claim, linkedIssueKeys,
//          attachments: [{ id, filename, mimeType, type }] }
//        `claim` is the raw claim object for the engine (see
//        src/engine/model.js); `type` is the classified evidence type
//        (see classifyEvidenceFile in src/jira-parse.js).
//        Throws when the issue does not exist or carries no
//        "ProofDesk claim" block.
//
//   getPurchaseOrder(poReference, linkedIssueKeys)
//     -> raw PO record { reference, amount, currency, vendor } | null
//        The PO record lives on a linked issue (a "ProofDesk purchase
//        order" block). Returns null when no linked issue carries a PO
//        block with this reference.
//
//   getAttachmentBytes(attachmentId) -> Buffer (the real bytes; the
//        engine hashes exactly these)
//
//   postVerdictComment(issueKey, commentText) -> { commentId }
//        `commentText` is the formatter output from src/comment.js.
//
// The production implementation is ForgeJiraClient in
// src/forge-jira-client.js; FakeJiraClient below mirrors the same
// contract in memory so the whole app layer is testable offline.

import { classifyEvidenceFile } from './jira-parse.js';

export class FakeJiraClient {
  constructor() {
    this.issues = new Map(); // issueKey -> stored issue
    this.purchaseOrders = new Map(); // reference -> raw PO record
    this.attachmentBytes = new Map(); // attachmentId -> Buffer
    this.comments = new Map(); // issueKey -> [{ id, body }]
    this.attachmentSeq = 0;
    this.commentSeq = 0;
  }

  /**
   * Seed a claim issue. `attachments` are
   * [{ filename, mimeType?, type?, bytes }]; the evidence type is taken
   * from the entry when given, else classified from the file name,
   * exactly like the production client.
   */
  addClaimIssue({ issueKey, summary = '', claim, attachments = [], linkedIssueKeys = [] }) {
    const storedAttachments = attachments.map((file) => {
      this.attachmentSeq += 1;
      const id = `att-${this.attachmentSeq}`;
      this.attachmentBytes.set(id, Buffer.from(file.bytes));
      return {
        id,
        filename: file.filename,
        mimeType: file.mimeType ?? 'application/octet-stream',
        type: file.type ?? classifyEvidenceFile(file.filename),
      };
    });
    this.issues.set(issueKey, {
      issueKey,
      summary,
      claim: { ...claim, issueKey },
      linkedIssueKeys: [...linkedIssueKeys],
      attachments: storedAttachments,
    });
    return this;
  }

  /** Seed a purchase-order record under its reference. */
  addPurchaseOrder(poRecord) {
    this.purchaseOrders.set(poRecord.reference, { ...poRecord });
    return this;
  }

  async getClaimIssue(issueKey) {
    const issue = this.issues.get(issueKey);
    if (!issue) {
      throw new Error(`Issue ${issueKey} not found`);
    }
    if (!issue.claim) {
      throw new Error(`Issue ${issueKey} carries no ProofDesk claim block`);
    }
    return {
      issueKey: issue.issueKey,
      summary: issue.summary,
      claim: { ...issue.claim },
      linkedIssueKeys: [...issue.linkedIssueKeys],
      attachments: issue.attachments.map((a) => ({ ...a })),
    };
  }

  async getPurchaseOrder(poReference, _linkedIssueKeys = []) {
    if (!poReference) return null;
    return this.purchaseOrders.get(poReference) ?? null;
  }

  async getAttachmentBytes(attachmentId) {
    const bytes = this.attachmentBytes.get(attachmentId);
    if (!bytes) {
      throw new Error(`Attachment ${attachmentId} not found`);
    }
    return Buffer.from(bytes);
  }

  async postVerdictComment(issueKey, commentText) {
    if (!this.issues.has(issueKey)) {
      throw new Error(`Issue ${issueKey} not found`);
    }
    this.commentSeq += 1;
    const comment = { id: `comment-${this.commentSeq}`, body: commentText };
    const list = this.comments.get(issueKey) ?? [];
    list.push(comment);
    this.comments.set(issueKey, list);
    return { commentId: comment.id };
  }

  /** Test helper: the comments posted to an issue, in order. */
  getComments(issueKey) {
    return [...(this.comments.get(issueKey) ?? [])];
  }
}
