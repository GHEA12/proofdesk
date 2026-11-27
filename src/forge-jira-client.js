// ForgeJiraClient — the production implementation of the Jira client
// interface (see src/jira-client.js), speaking Jira Cloud REST as the
// app user.
//
// The transport is injected: the constructor takes
// { requestJira, route } as provided by @forge/api, wired in
// src/forge-api.js — the only module that imports @forge/api. Injecting
// the transport keeps this class fully testable offline with a stub
// requestJira that returns canned REST payloads; the class itself has
// no Forge imports.
//
// Scopes used (declared in manifest.yml): read:jira-work for the reads,
// write:jira-work for the verdict comment.

import { adfToText, parseClaimBlock, parsePoBlock, classifyEvidenceFile, textToAdf } from './jira-parse.js';

const ISSUE_FIELDS = 'summary,description,attachment,issuelinks';

export class ForgeJiraClient {
  constructor({ requestJira, route }) {
    if (typeof requestJira !== 'function' || typeof route !== 'function') {
      throw new TypeError('ForgeJiraClient needs { requestJira, route } from @forge/api');
    }
    this.requestJira = requestJira;
    this.route = route;
  }

  async _fetchIssue(issueKey) {
    const response = await this.requestJira(
      this.route`/rest/api/3/issue/${issueKey}?fields=${ISSUE_FIELDS}`,
    );
    if (!response.ok) {
      throw new Error(`Jira issue fetch failed for ${issueKey}: HTTP ${response.status}`);
    }
    return response.json();
  }

  async getClaimIssue(issueKey) {
    const issue = await this._fetchIssue(issueKey);
    const fields = issue.fields ?? {};
    const claimFields = parseClaimBlock(adfToText(fields.description));
    if (!claimFields) {
      throw new Error(`Issue ${issueKey} carries no ProofDesk claim block`);
    }
    const attachments = (fields.attachment ?? []).map((a) => ({
      id: String(a.id),
      filename: a.filename,
      mimeType: a.mimeType ?? 'application/octet-stream',
      type: classifyEvidenceFile(a.filename),
      contentUrl: a.content,
    }));
    const linkedIssueKeys = [];
    for (const link of fields.issuelinks ?? []) {
      if (link.inwardIssue?.key) linkedIssueKeys.push(link.inwardIssue.key);
      if (link.outwardIssue?.key) linkedIssueKeys.push(link.outwardIssue.key);
    }
    return {
      issueKey,
      summary: fields.summary ?? '',
      claim: { ...claimFields, issueKey },
      linkedIssueKeys,
      attachments,
    };
  }

  async getPurchaseOrder(poReference, linkedIssueKeys = []) {
    if (!poReference) return null;
    for (const key of linkedIssueKeys) {
      let issue;
      try {
        issue = await this._fetchIssue(key);
      } catch {
        continue; // A link we cannot read is not a PO candidate.
      }
      const po = parsePoBlock(adfToText(issue.fields?.description));
      if (po && po.reference === poReference) {
        return po;
      }
    }
    return null;
  }

  async getAttachmentBytes(attachmentId) {
    // Attachment ids from getClaimIssue are resolved back through the
    // content endpoint; the bytes returned are exactly what gets hashed.
    const response = await this.requestJira(
      this.route`/rest/api/3/attachment/content/${attachmentId}`,
    );
    if (!response.ok) {
      throw new Error(`Attachment download failed for ${attachmentId}: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async postVerdictComment(issueKey, commentText) {
    const response = await this.requestJira(this.route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body: textToAdf(commentText) }),
    });
    if (!response.ok) {
      throw new Error(`Comment post failed for ${issueKey}: HTTP ${response.status}`);
    }
    const created = await response.json();
    return { commentId: created?.id != null ? String(created.id) : null };
  }
}
