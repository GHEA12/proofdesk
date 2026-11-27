// ProofDesk demo seeder.
//
// Creates the seeded demo pack (demo/pack.json) as real Jira issues:
// one purchase-order issue per pack PO, and one claim issue per pack
// case, linked to its PO issue and carrying the case's evidence files
// as attachments. The issue descriptions carry the exact "ProofDesk
// claim" / "ProofDesk purchase order" text blocks that the production
// Jira client parses (see src/jira-parse.js), so a seeded site behaves
// exactly like the local demo pack.
//
// The seeding surface mirrors the FakeJiraClient seeding contract in
// src/jira-client.js (addPurchaseOrder / addClaimIssue), extended with
// ensureProject: the resolver only ever reads through that interface,
// and this script is the write-side companion for demo environments.
//
// Usage:
//   node scripts/seed-demo.mjs [--dry-run] [--project-key FIN]
//                              [--project-name "Finance Approvals (ProofDesk demo)"]
//   node scripts/seed-demo.mjs --apply [--skip-project]
//
// Dry-run is the default and needs no environment: it prints exactly
// what would be created (project, issues with their full description
// text, links, attachments with byte sizes and SHA-256 hashes) and
// then round-trip checks every generated description through the real
// parsers (parseClaimBlock / parsePoBlock) against the pack values.
//
// --apply talks to a real Jira Cloud site over REST API v3 and needs
// JIRA_SEED_BASE_URL, JIRA_SEED_EMAIL and JIRA_SEED_API_TOKEN in the
// environment (an Atlassian API token for an account that can create
// issues and attachments in the target project; project creation also
// needs Jira admin rights, or create the project in the UI first and
// pass --skip-project). Nothing is created without --apply.
//
// Create the issues in pack order and run ProofDesk checks in the same
// order: the duplicate case (case-c) only makes sense after the clean
// case (case-a) has been receipted. Jira assigns real issue keys at
// apply time; the pack keys (FIN-101 and friends) are labels only.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256Hex } from '../src/engine/hash.js';
import { parseClaimBlock, parsePoBlock, classifyEvidenceFile, textToAdf } from '../src/jira-parse.js';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demoDir = path.join(projectDir, 'demo');

// ---------------------------------------------------------------------------
// Block text builders. These produce the exact plain-text blocks the
// production parser reads back; amounts are written with two decimals
// and no grouping separators so the text stays human-writable.
// ---------------------------------------------------------------------------

function amountText(amount) {
  return Number(amount).toFixed(2);
}

export function claimDescription(demoCase) {
  const { claim } = demoCase;
  const lines = [
    `Seeded demo case ${demoCase.id} from the ProofDesk demo pack. All names and documents are fabricated sample data.`,
    demoCase.narrative,
    `Expected verdict when checks run in pack order: ${demoCase.expectedVerdict}.`,
    '',
    'ProofDesk claim',
    `Type: ${claim.claimType}`,
    `Amount: ${amountText(claim.amount)}`,
    `Currency: ${claim.currency}`,
    `Vendor: ${claim.vendor}`,
    `Invoice: ${claim.invoiceNumber}`,
  ];
  if (claim.poReference) lines.push(`PO: ${claim.poReference}`);
  return lines.join('\n');
}

export function poDescription(po) {
  return [
    'Seeded demo purchase order from the ProofDesk demo pack. Fabricated sample data.',
    '',
    'ProofDesk purchase order',
    `Reference: ${po.reference}`,
    `Amount: ${amountText(po.amount)}`,
    `Currency: ${po.currency}`,
    `Vendor: ${po.vendor}`,
  ].join('\n');
}

export function claimSummary(demoCase) {
  const { claim } = demoCase;
  return `Vendor delivery claim: ${claim.vendor}, invoice ${claim.invoiceNumber} (${demoCase.id})`;
}

export function poSummary(po) {
  return `Purchase order ${po.reference}: ${po.vendor}, ${po.currency} ${amountText(po.amount)}`;
}

const MIME_BY_EXTENSION = {
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
};

function mimeTypeFor(filename) {
  return MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Seed plan: the ordered list of operations, independent of the client
// that executes them. Attachments carry their real bytes so the plan
// (and the dry-run printout) can show sizes and SHA-256 hashes.
// ---------------------------------------------------------------------------

export async function buildSeedPlan(pack, { projectKey, projectName }) {
  const steps = [{ kind: 'ensure-project', projectKey, projectName }];

  for (const po of pack.purchaseOrders) {
    steps.push({
      kind: 'create-po-issue',
      ref: po.reference,
      summary: poSummary(po),
      description: poDescription(po),
      po,
    });
  }

  for (const demoCase of pack.cases) {
    const attachments = [];
    for (const item of demoCase.evidence) {
      const bytes = await readFile(path.join(demoDir, item.file));
      attachments.push({
        filename: item.name,
        type: item.type,
        mimeType: mimeTypeFor(item.name),
        bytes,
        size: bytes.length,
        sha256: sha256Hex(bytes),
      });
    }
    steps.push({
      kind: 'create-claim-issue',
      ref: demoCase.id,
      packIssueKey: demoCase.claim.issueKey,
      summary: claimSummary(demoCase),
      description: claimDescription(demoCase),
      claim: demoCase.claim,
      linkToPoReference: demoCase.claim.poReference ?? null,
      attachments,
      expectedVerdict: demoCase.expectedVerdict,
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Dry-run client: executes the plan against nothing. Prints every
// operation in full and returns placeholder keys (NEW-1, NEW-2, ...)
// so link steps can name their targets. This printout is the exact
// contract the REST client fulfils at apply time.
// ---------------------------------------------------------------------------

class DryRunSeedClient {
  constructor() {
    this.seq = 0;
    this.stepNo = 0;
  }

  #nextKey() {
    this.seq += 1;
    return `NEW-${this.seq}`;
  }

  #header(title) {
    this.stepNo += 1;
    console.log(`\n--- Step ${this.stepNo}: ${title}`);
  }

  async ensureProject({ projectKey, projectName }) {
    this.#header(`ensure project ${projectKey} "${projectName}" (create if missing)`);
    return { projectKey };
  }

  async addPurchaseOrder({ summary, description }) {
    const issueKey = this.#nextKey();
    this.#header(`create purchase-order issue -> ${issueKey}`);
    console.log(`Summary: ${summary}`);
    console.log('Description:');
    console.log(indent(description));
    return { issueKey };
  }

  async addClaimIssue({ summary, description, attachments, linkToIssueKeys }) {
    const issueKey = this.#nextKey();
    this.#header(`create claim issue -> ${issueKey}`);
    console.log(`Summary: ${summary}`);
    console.log('Description:');
    console.log(indent(description));
    for (const key of linkToIssueKeys) {
      console.log(`Link: ${issueKey} Relates to ${key}`);
    }
    for (const file of attachments) {
      console.log(
        `Attach: ${file.filename} (${file.type}, ${file.mimeType}, ${file.size} bytes, sha256 \`${file.sha256}\`)`,
      );
    }
    return { issueKey };
  }
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// REST client for --apply. Speaks Jira Cloud REST API v3 with an
// injected fetch implementation (defaults to the global fetch), in the
// same spirit as ForgeJiraClient's injected transport. Not exercised
// by the dry run; it exists so the deploy phase can seed a real site
// with the identical plan.
// ---------------------------------------------------------------------------

class RestSeedClient {
  constructor({ baseUrl, email, apiToken, fetchImpl = globalThis.fetch }) {
    if (!baseUrl || !email || !apiToken) {
      throw new Error('RestSeedClient needs baseUrl, email and apiToken');
    }
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('RestSeedClient needs a fetch implementation');
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
    this.projectKey = null;
  }

  async #request(pathname, { method = 'GET', body, headers = {} } = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Jira REST ${method} ${pathname} failed: HTTP ${response.status} ${detail}`.trim());
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async ensureProject({ projectKey, projectName, skipCreate = false }) {
    this.projectKey = projectKey;
    const existing = await this.fetchImpl(
      `${this.baseUrl}/rest/api/3/project/${encodeURIComponent(projectKey)}`,
      { headers: { Authorization: this.authHeader, Accept: 'application/json' } },
    );
    if (existing.ok) return { projectKey };
    if (skipCreate) {
      throw new Error(`Project ${projectKey} does not exist and --skip-project was given`);
    }
    // Project creation needs Jira admin rights and a lead account.
    const myself = await this.#request('/rest/api/3/myself');
    await this.#request('/rest/api/3/project', {
      method: 'POST',
      body: {
        key: projectKey,
        name: projectName,
        projectTypeKey: 'business',
        assigneeType: 'PROJECT_LEAD',
        leadAccountId: myself.accountId,
      },
    });
    return { projectKey };
  }

  async #createIssue({ summary, description }) {
    const created = await this.#request('/rest/api/3/issue', {
      method: 'POST',
      body: {
        fields: {
          project: { key: this.projectKey },
          summary,
          description: textToAdf(description),
          issuetype: { name: 'Task' },
        },
      },
    });
    return { issueKey: created.key };
  }

  async addPurchaseOrder({ summary, description }) {
    return this.#createIssue({ summary, description });
  }

  async addClaimIssue({ summary, description, attachments, linkToIssueKeys }) {
    const { issueKey } = await this.#createIssue({ summary, description });
    for (const targetKey of linkToIssueKeys) {
      await this.#request('/rest/api/3/issueLink', {
        method: 'POST',
        body: {
          type: { name: 'Relates' },
          inwardIssue: { key: issueKey },
          outwardIssue: { key: targetKey },
        },
      });
    }
    for (const file of attachments) {
      const form = new FormData();
      form.append('file', new Blob([file.bytes], { type: file.mimeType }), file.filename);
      const response = await this.fetchImpl(
        `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
        {
          method: 'POST',
          headers: { Authorization: this.authHeader, 'X-Atlassian-Token': 'no-check' },
          body: form,
        },
      );
      if (!response.ok) {
        throw new Error(
          `Attachment upload failed for ${file.filename} on ${issueKey}: HTTP ${response.status}`,
        );
      }
    }
    return { issueKey };
  }
}

// ---------------------------------------------------------------------------
// Plan execution: identical for both clients. Tracks created PO issue
// keys by reference so claim issues can link to them.
// ---------------------------------------------------------------------------

async function executePlan(steps, client, { skipProject = false } = {}) {
  const poIssueKeyByReference = new Map();
  const createdClaims = [];
  for (const step of steps) {
    if (step.kind === 'ensure-project') {
      await client.ensureProject({
        projectKey: step.projectKey,
        projectName: step.projectName,
        skipCreate: skipProject,
      });
    } else if (step.kind === 'create-po-issue') {
      const { issueKey } = await client.addPurchaseOrder({
        summary: step.summary,
        description: step.description,
      });
      poIssueKeyByReference.set(step.ref, issueKey);
    } else if (step.kind === 'create-claim-issue') {
      const linkToIssueKeys = step.linkToPoReference
        ? [poIssueKeyByReference.get(step.linkToPoReference)]
        : [];
      const { issueKey } = await client.addClaimIssue({
        summary: step.summary,
        description: step.description,
        attachments: step.attachments,
        linkToIssueKeys,
      });
      createdClaims.push({ ref: step.ref, issueKey, expectedVerdict: step.expectedVerdict });
    }
  }
  return createdClaims;
}

// ---------------------------------------------------------------------------
// Round-trip check (dry run): every generated description must parse
// back through the production parsers to the pack's own values, and
// every attachment name must classify to the pack's evidence type.
// ---------------------------------------------------------------------------

function roundTripCheck(steps, pack) {
  const failures = [];
  const poByReference = new Map(pack.purchaseOrders.map((po) => [po.reference, po]));

  for (const step of steps) {
    if (step.kind === 'create-po-issue') {
      const parsed = parsePoBlock(step.description);
      const expected = poByReference.get(step.ref);
      if (!parsed) {
        failures.push(`${step.ref}: PO block did not parse`);
        continue;
      }
      if (
        parsed.reference !== expected.reference ||
        parsed.amount !== expected.amount ||
        parsed.currency !== expected.currency ||
        parsed.vendor !== expected.vendor
      ) {
        failures.push(`${step.ref}: PO block parsed to ${JSON.stringify(parsed)}`);
      }
    }
    if (step.kind === 'create-claim-issue') {
      const parsed = parseClaimBlock(step.description);
      const expected = step.claim;
      if (!parsed) {
        failures.push(`${step.ref}: claim block did not parse`);
        continue;
      }
      if (
        parsed.claimType !== expected.claimType ||
        parsed.amount !== expected.amount ||
        parsed.currency !== expected.currency ||
        parsed.vendor !== expected.vendor ||
        parsed.invoiceNumber !== expected.invoiceNumber ||
        (parsed.poReference ?? null) !== (expected.poReference ?? null)
      ) {
        failures.push(`${step.ref}: claim block parsed to ${JSON.stringify(parsed)}`);
      }
      for (const file of step.attachments) {
        const classified = classifyEvidenceFile(file.filename);
        if (classified !== file.type) {
          failures.push(`${step.ref}: ${file.filename} classifies as ${classified}, pack says ${file.type}`);
        }
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: false,
    skipProject: false,
    projectKey: 'FIN',
    projectName: 'Finance Approvals (ProofDesk demo)',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--skip-project') args.skipProject = true;
    else if (arg === '--project-key') args.projectKey = argv[++i];
    else if (arg === '--project-name') args.projectName = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.apply && args.dryRun) throw new Error('Pass either --apply or --dry-run, not both');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pack = JSON.parse(await readFile(path.join(demoDir, 'pack.json'), 'utf8'));
  const steps = await buildSeedPlan(pack, {
    projectKey: args.projectKey,
    projectName: args.projectName,
  });

  if (!args.apply) {
    console.log('ProofDesk demo seeder: DRY RUN (nothing will be created)');
    console.log(`Pack: ${pack.cases.length} claim cases, ${pack.purchaseOrders.length} purchase orders`);
    const createdClaims = await executePlan(steps, new DryRunSeedClient());

    console.log('\n--- Round-trip check (production parsers vs pack values)');
    const failures = roundTripCheck(steps, pack);
    if (failures.length > 0) {
      for (const failure of failures) console.log(`FAIL  ${failure}`);
      console.error(`Dry run FAILED: ${failures.length} round-trip mismatch(es).`);
      process.exit(1);
    }
    console.log('OK    every claim and PO description parses back to the pack values');
    console.log('OK    every attachment name classifies to its pack evidence type');

    console.log('\n--- After seeding, run ProofDesk checks in this order');
    for (const claim of createdClaims) {
      console.log(`${claim.issueKey} (${claim.ref}): expected verdict ${claim.expectedVerdict}`);
    }
    console.log(
      '\nNote: Jira assigns real issue keys at apply time; NEW-n keys above are placeholders.\n' +
        'Run with --apply (and JIRA_SEED_BASE_URL / JIRA_SEED_EMAIL / JIRA_SEED_API_TOKEN set) to create these for real.',
    );
    return;
  }

  const { JIRA_SEED_BASE_URL, JIRA_SEED_EMAIL, JIRA_SEED_API_TOKEN } = process.env;
  if (!JIRA_SEED_BASE_URL || !JIRA_SEED_EMAIL || !JIRA_SEED_API_TOKEN) {
    console.error(
      '--apply needs JIRA_SEED_BASE_URL, JIRA_SEED_EMAIL and JIRA_SEED_API_TOKEN in the environment. Nothing was created.',
    );
    process.exit(2);
  }
  const client = new RestSeedClient({
    baseUrl: JIRA_SEED_BASE_URL,
    email: JIRA_SEED_EMAIL,
    apiToken: JIRA_SEED_API_TOKEN,
  });
  const createdClaims = await executePlan(steps, client, { skipProject: args.skipProject });
  console.log('Seeded demo pack:');
  for (const claim of createdClaims) {
    console.log(`${claim.issueKey} (${claim.ref}): expected verdict ${claim.expectedVerdict}`);
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
