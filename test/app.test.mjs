// ProofDesk app layer — tests for the resolver service, the KVS storage
// adapter, the Jira clients, the comment formatter, the Rovo handlers,
// and the frontend view models. Everything runs offline against fakes.
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { InMemoryRegistry, runVerification, verifyChain, VERDICTS } from '../src/engine/index.js';
import { KvsRegistry } from '../src/registry-kvs.js';
import { FakeJiraClient } from '../src/jira-client.js';
import { ForgeJiraClient } from '../src/forge-jira-client.js';
import {
  adfToText,
  parseClaimBlock,
  parsePoBlock,
  classifyEvidenceFile,
  textToAdf,
} from '../src/jira-parse.js';
import { formatReceiptComment, formatAmount } from '../src/comment.js';
import { createProofDeskService, createResolver } from '../src/resolver.js';
import { createRovoHandlers } from '../src/rovo.js';
import { createHandler } from '../src/index.js';
import { panelViewModel, ledgerViewModel } from '../src/frontend/viewmodel.js';

const NOW = '2026-11-27T00:00:00.000Z';
const now = () => NOW;
const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- shared fixtures ------------------------------------------------------

/** Forge KVS-shaped fake storage with JSON round-trip semantics. */
class FakeKvsStorage {
  constructor() {
    this.map = new Map();
  }

  async get(key) {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : JSON.parse(raw);
  }

  async set(key, value) {
    this.map.set(key, JSON.stringify(value));
  }

  async delete(key) {
    this.map.delete(key);
  }
}

/** Seed a FakeJiraClient from the demo pack, exactly like the preview. */
async function seedFakeFromDemoPack() {
  const pack = JSON.parse(await readFile(path.join(projectDir, 'demo', 'pack.json'), 'utf8'));
  const jira = new FakeJiraClient();
  for (const po of pack.purchaseOrders) jira.addPurchaseOrder(po);
  for (const demoCase of pack.cases) {
    const attachments = [];
    for (const item of demoCase.evidence) {
      attachments.push({
        filename: item.name,
        bytes: await readFile(path.join(projectDir, 'demo', item.file)),
      });
    }
    jira.addClaimIssue({
      issueKey: demoCase.claim.issueKey,
      summary: demoCase.narrative,
      claim: demoCase.claim,
      attachments,
    });
  }
  return { jira, pack };
}

// --- registry contract: in-memory and KVS behave identically --------------

const registryFactories = [
  ['InMemoryRegistry', () => new InMemoryRegistry()],
  ['KvsRegistry', () => new KvsRegistry(new FakeKvsStorage())],
];

for (const [name, makeRegistry] of registryFactories) {
  test(`registry contract (${name}): put, lookups, chain head, order`, async () => {
    const registry = makeRegistry();
    assert.equal(await registry.getChainHead(), null);
    assert.deepEqual(await registry.getAll(), []);
    assert.equal(await registry.findByInvoice('INV-2026-001'), null);
    assert.equal(await registry.findByHash('0'.repeat(64)), null);

    const claim = {
      issueKey: 'FIN-101', claimType: 'vendor-delivery', amount: 1250, currency: 'USD',
      vendor: 'Acme Logistics', invoiceNumber: 'INV-2026-001', poReference: 'PO-1001',
    };
    const po = { reference: 'PO-1001', amount: 1250, currency: 'USD', vendor: 'Acme Logistics' };
    const evidence = [
      { name: 'invoice.txt', type: 'invoice', bytes: Buffer.from('invoice bytes') },
      {
        name: 'note.json', type: 'delivery-note',
        bytes: Buffer.from(JSON.stringify({
          noteNumber: 'DN-T', poReference: 'PO-1001', currency: 'USD', total: 1250,
          lineItems: [{ description: 'Pallets', quantity: 10, unitPrice: 125, total: 1250 }],
        })),
      },
    ];
    const first = await runVerification({ claim, poRecord: po, evidenceFiles: evidence, registry, now: NOW });
    const second = await runVerification({
      claim: { ...claim, issueKey: 'FIN-102', invoiceNumber: 'INV-2026-002' },
      poRecord: po, evidenceFiles: evidence, registry, now: NOW,
    });

    assert.equal((await registry.findByInvoice('INV-2026-001')).id, first.receipt.id);
    assert.equal((await registry.findByInvoice('INV-2026-002')).id, second.receipt.id);
    assert.equal((await registry.findByHash(first.receipt.evidence[0].sha256)).id, first.receipt.id);
    assert.equal(await registry.getChainHead(), second.receipt.hash);
    const all = await registry.getAll();
    assert.deepEqual(all.map((r) => r.id), [first.receipt.id, second.receipt.id]);
    assert.equal(verifyChain(all).valid, true);
  });
}

test('KvsRegistry persists across instances over the same storage', async () => {
  const storage = new FakeKvsStorage();
  const first = new KvsRegistry(storage);
  const { receipt } = await runVerification({
    claim: {
      issueKey: 'FIN-101', claimType: 'expense', amount: 42, currency: 'USD',
      vendor: 'Cafe', invoiceNumber: 'INV-X', poReference: null,
    },
    poRecord: null,
    evidenceFiles: [{ name: 'receipt.txt', type: 'receipt', bytes: Buffer.from('r') }],
    registry: first,
    now: NOW,
  });
  const reopened = new KvsRegistry(storage);
  assert.equal(await reopened.getChainHead(), receipt.hash);
  assert.deepEqual((await reopened.getAll()).map((r) => r.id), [receipt.id]);
  // JSON round-trip: the reopened receipt is a plain object, still valid.
  assert.equal(verifyChain(await reopened.getAll()).valid, true);
});

test('KvsRegistry runs the whole demo pack and keeps the first receipt in the indexes', async () => {
  const pack = JSON.parse(await readFile(path.join(projectDir, 'demo', 'pack.json'), 'utf8'));
  const poByReference = new Map(pack.purchaseOrders.map((po) => [po.reference, po]));
  const registry = new KvsRegistry(new FakeKvsStorage());
  for (const demoCase of pack.cases) {
    const evidenceFiles = [];
    for (const item of demoCase.evidence) {
      evidenceFiles.push({
        name: item.name,
        type: item.type,
        bytes: await readFile(path.join(projectDir, 'demo', item.file)),
      });
    }
    const { verdict } = await runVerification({
      claim: demoCase.claim,
      poRecord: poByReference.get(demoCase.claim.poReference) ?? null,
      evidenceFiles,
      registry,
      now: NOW,
    });
    assert.equal(verdict, demoCase.expectedVerdict, demoCase.id);
  }
  assert.equal(verifyChain(await registry.getAll()).valid, true);
  // INV-2026-001 was receipted on FIN-101 first; the FIN-103 resubmission
  // must not overwrite the index.
  assert.equal((await registry.findByInvoice('INV-2026-001')).issueKey, 'FIN-101');
});

// --- Jira parsing -----------------------------------------------------------

test('adfToText flattens paragraphs and hard breaks', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Line one' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Line two' },
          { type: 'hardBreak' },
          { type: 'text', text: 'Line three' },
        ],
      },
    ],
  };
  assert.equal(adfToText(adf), 'Line one\nLine two\nLine three');
  assert.equal(adfToText(null), '');
  assert.equal(adfToText('plain'), 'plain');
});

test('parseClaimBlock and parsePoBlock read the documented blocks', () => {
  const description = [
    'Please approve this delivery.',
    '',
    'ProofDesk claim',
    'Type: vendor-delivery',
    'Amount: 1250.00',
    'Currency: USD',
    'Vendor: Acme Logistics',
    'Invoice: INV-2026-001',
    'PO: PO-1001',
    '',
    'Thanks.',
  ].join('\n');
  assert.deepEqual(parseClaimBlock(description), {
    claimType: 'vendor-delivery',
    amount: 1250,
    currency: 'USD',
    vendor: 'Acme Logistics',
    invoiceNumber: 'INV-2026-001',
    poReference: 'PO-1001',
  });
  assert.equal(parseClaimBlock('no block here'), null);

  const poText = [
    'ProofDesk purchase order',
    'Reference: PO-1001',
    'Amount: 1250.00',
    'Currency: USD',
    'Vendor: Acme Logistics',
  ].join('\n');
  assert.deepEqual(parsePoBlock(poText), {
    reference: 'PO-1001', amount: 1250, currency: 'USD', vendor: 'Acme Logistics',
  });
  assert.equal(parsePoBlock('nothing'), null);
});

test('classifyEvidenceFile follows the file-name convention', () => {
  assert.equal(classifyEvidenceFile('INV-2026-001-invoice.txt'), 'invoice');
  assert.equal(classifyEvidenceFile('DN-2026-001-delivery-note.json'), 'delivery-note');
  assert.equal(classifyEvidenceFile('milestone-sign-off.pdf'), 'sign-off');
  assert.equal(classifyEvidenceFile('taxi-receipt.png'), 'receipt');
  assert.equal(classifyEvidenceFile('random.bin'), 'other');
});

// --- comment formatter -------------------------------------------------------

test('formatReceiptComment renders the clean verdict comment', async () => {
  const registry = new InMemoryRegistry();
  const claim = {
    issueKey: 'FIN-101', claimType: 'vendor-delivery', amount: 1250, currency: 'USD',
    vendor: 'Acme Logistics', invoiceNumber: 'INV-2026-001', poReference: 'PO-1001',
  };
  const po = { reference: 'PO-1001', amount: 1250, currency: 'USD', vendor: 'Acme Logistics' };
  const evidence = [{ name: 'invoice.txt', type: 'invoice', bytes: Buffer.from('invoice bytes') }];
  const first = await runVerification({ claim, poRecord: po, evidenceFiles: evidence, registry, now: NOW });
  const text = formatReceiptComment(first.receipt);

  assert.ok(text.startsWith('**ProofDesk verdict: NEEDS EVIDENCE**')); // no delivery note attached
  for (const section of ['**Claim**', '**Checks**', '**Evidence (SHA-256)**', '**Receipt chain**']) {
    assert.ok(text.includes(section), `missing section ${section}`);
  }
  assert.ok(text.includes(`Receipt \`${first.receipt.id}\``));
  assert.ok(text.includes('1,250.00 USD'));
  assert.ok(text.includes(`\`${first.receipt.evidence[0].sha256}\``));
  assert.ok(text.includes(`Receipt hash: \`${first.receipt.hash}\``));
  assert.ok(text.includes('none. This is the first receipt in the chain.'));

  const second = await runVerification({
    claim: { ...claim, issueKey: 'FIN-102', invoiceNumber: 'INV-2026-002' },
    poRecord: po, evidenceFiles: evidence, registry, now: NOW,
  });
  const secondText = formatReceiptComment(second.receipt);
  assert.ok(secondText.includes(`Previous receipt: \`${first.receipt.hash}\``));
  assert.equal(formatAmount(1250), '1,250.00');
  assert.equal(formatAmount(null), '(no amount)');
});

test('textToAdf converts the formatter output into a valid ADF doc', async () => {
  const registry = new InMemoryRegistry();
  const { receipt } = await runVerification({
    claim: {
      issueKey: 'FIN-101', claimType: 'expense', amount: 42, currency: 'USD',
      vendor: 'Cafe', invoiceNumber: 'INV-X', poReference: null,
    },
    poRecord: null,
    evidenceFiles: [{ name: 'receipt.txt', type: 'receipt', bytes: Buffer.from('r') }],
    registry,
    now: NOW,
  });
  const adf = textToAdf(formatReceiptComment(receipt));
  assert.equal(adf.type, 'doc');
  assert.equal(adf.version, 1);
  const title = adf.content[0];
  assert.equal(title.type, 'paragraph');
  assert.deepEqual(title.content[0].marks, [{ type: 'strong' }]);
  assert.ok(title.content[0].text.includes('ProofDesk verdict'));
  const list = adf.content.find((node) => node.type === 'bulletList');
  assert.ok(list, 'checks render as a bullet list');
  const serialized = JSON.stringify(adf);
  assert.ok(serialized.includes(receipt.hash), 'hash survives as a code-marked node');
  assert.ok(serialized.includes('"code"'));
});

// --- resolver service over the fake Jira client ------------------------------

test('resolver: panel state, verification run, comment, receipt, ledger', async () => {
  const { jira, pack } = await seedFakeFromDemoPack();
  const registry = new InMemoryRegistry();
  const resolver = createResolver({ jira, registry, now });

  const before = await resolver.resolve('getPanelState', { issueKey: 'FIN-101' });
  assert.equal(before.claim.invoiceNumber, 'INV-2026-001');
  assert.equal(before.evidence.length, 2);
  assert.equal(before.latestReceipt, null);
  assert.equal(before.chainValid, true);

  const run = await resolver.resolve('runVerification', { issueKey: 'FIN-101' });
  assert.equal(run.verdict, VERDICTS.VERIFIED);
  assert.ok(run.commentId, 'panel runs post the verdict comment');

  const comments = jira.getComments('FIN-101');
  assert.equal(comments.length, 1);
  assert.equal(comments[0].body, formatReceiptComment(run.receipt));
  assert.ok(comments[0].body.includes('**ProofDesk verdict: VERIFIED**'));

  const after = await resolver.resolve('getPanelState', { issueKey: 'FIN-101' });
  assert.equal(after.latestReceipt.id, run.receipt.id);

  const receipt = await resolver.resolve('getReceipt', { issueKey: 'FIN-101' });
  assert.equal(receipt.id, run.receipt.id);
  assert.equal(await resolver.resolve('getReceipt', { issueKey: 'FIN-102' }), null);

  for (const demoCase of pack.cases.slice(1)) {
    await resolver.resolve('runVerification', { issueKey: demoCase.claim.issueKey });
  }
  const ledger = await resolver.resolve('listReceipts');
  assert.equal(ledger.receipts.length, pack.cases.length);
  assert.equal(ledger.chain.valid, true);
  const chain = await resolver.resolve('verifyChain');
  assert.equal(chain.valid, true);
  assert.equal(chain.checked, pack.cases.length);
});

test('resolver: duplicate case mismatches through the full app path', async () => {
  const { jira } = await seedFakeFromDemoPack();
  const resolver = createResolver({ jira, registry: new InMemoryRegistry(), now });
  await resolver.resolve('runVerification', { issueKey: 'FIN-101' });
  const dup = await resolver.resolve('runVerification', { issueKey: 'FIN-103' });
  assert.equal(dup.verdict, VERDICTS.MISMATCH);
  assert.equal(dup.checks.find((c) => c.id === 'duplicate').status, 'fail');
});

test('resolver: rejects unknown functions and missing issue keys', async () => {
  const { jira } = await seedFakeFromDemoPack();
  const resolver = createResolver({ jira, registry: new InMemoryRegistry(), now });
  await assert.rejects(() => resolver.resolve('nope', {}), /Unknown ProofDesk resolver function/);
  await assert.rejects(() => resolver.resolve('getPanelState', {}), /issueKey/);
});

test('index handler dispatches locally with injected fakes', async () => {
  const { jira } = await seedFakeFromDemoPack();
  const handler = createHandler({ jira, registry: new InMemoryRegistry(), now });
  const empty = await handler({ functionKey: 'listReceipts', payload: {} });
  assert.deepEqual(empty.receipts, []);
  assert.equal(empty.chain.valid, true);
  const run = await handler({
    functionKey: 'runVerification',
    payload: { issueKey: 'FIN-102' },
  });
  assert.equal(run.verdict, VERDICTS.NEEDS_EVIDENCE);
});

// --- Rovo action handlers ------------------------------------------------------

test('rovo: verifyEvidence stores a receipt without posting a comment', async () => {
  const { jira } = await seedFakeFromDemoPack();
  const registry = new InMemoryRegistry();
  const rovo = createRovoHandlers({ jira, registry, now });

  const result = await rovo.verifyEvidence({ issueKey: 'FIN-101' });
  assert.equal(result.verdict, VERDICTS.VERIFIED);
  assert.equal(result.commentPosted, false);
  assert.ok(result.receiptId.startsWith('pd_'));
  assert.equal(result.checks.length, 3);
  assert.equal(jira.getComments('FIN-101').length, 0, 'Rovo runs never post comments');
  assert.equal((await registry.getAll()).length, 1, 'the receipt is still stored and chained');

  const found = await rovo.getReceipt({ issueKey: 'FIN-101' });
  assert.equal(found.found, true);
  assert.equal(found.receipt.id, result.receiptId);

  const missing = await rovo.getReceipt({ issueKey: 'FIN-104' });
  assert.equal(missing.found, false);
  assert.ok(missing.message.includes('has not been verified'));

  await assert.rejects(() => rovo.verifyEvidence({}), /issueKey/);
});

// --- ForgeJiraClient over a stub transport --------------------------------------

function paragraphAdf(text) {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function stubTransport() {
  const calls = [];
  const claimAdf = paragraphAdf(
    [
      'ProofDesk claim',
      'Type: vendor-delivery',
      'Amount: 1250.00',
      'Currency: USD',
      'Vendor: Acme Logistics',
      'Invoice: INV-2026-001',
      'PO: PO-1001',
    ].join('\n'),
  );
  const poAdf = paragraphAdf(
    [
      'ProofDesk purchase order',
      'Reference: PO-1001',
      'Amount: 1250.00',
      'Currency: USD',
      'Vendor: Acme Logistics',
    ].join('\n'),
  );
  const jsonResponse = (payload) => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });
  const requestJira = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/issue/FIN-101?')) {
      return jsonResponse({
        key: 'FIN-101',
        fields: {
          summary: 'Approve the Acme delivery',
          description: claimAdf,
          attachment: [
            { id: 10001, filename: 'INV-2026-001-invoice.txt', mimeType: 'text/plain', content: 'https://example.invalid/att/10001' },
          ],
          issuelinks: [{ outwardIssue: { key: 'FIN-100' } }],
        },
      });
    }
    if (url.includes('/issue/FIN-100?')) {
      return jsonResponse({ key: 'FIN-100', fields: { summary: 'PO-1001', description: poAdf, attachment: [], issuelinks: [] } });
    }
    if (url.includes('/attachment/content/10001')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('invoice bytes').buffer,
      };
    }
    if (url.includes('/issue/FIN-101/comment')) {
      return jsonResponse({ id: '555' });
    }
    throw new Error(`Unexpected stub URL: ${url}`);
  };
  const route = (strings, ...values) =>
    strings.reduce((acc, part, i) => acc + part + (values[i] ?? ''), '');
  return { requestJira, route, calls };
}

test('ForgeJiraClient parses issues, walks links for the PO, downloads bytes, posts ADF comments', async () => {
  const transport = stubTransport();
  const client = new ForgeJiraClient(transport);

  const issue = await client.getClaimIssue('FIN-101');
  assert.equal(issue.claim.invoiceNumber, 'INV-2026-001');
  assert.equal(issue.claim.amount, 1250);
  assert.deepEqual(issue.linkedIssueKeys, ['FIN-100']);
  assert.equal(issue.attachments[0].type, 'invoice');

  const po = await client.getPurchaseOrder('PO-1001', issue.linkedIssueKeys);
  assert.equal(po.reference, 'PO-1001');
  assert.equal(po.amount, 1250);
  assert.equal(await client.getPurchaseOrder('PO-9999', issue.linkedIssueKeys), null);

  const bytes = await client.getAttachmentBytes('10001');
  assert.equal(Buffer.from(bytes).toString('utf8'), 'invoice bytes');

  const posted = await client.postVerdictComment('FIN-101', '**ProofDesk verdict: VERIFIED**');
  assert.equal(posted.commentId, '555');
  const commentCall = transport.calls.find((c) => c.url.includes('/comment'));
  const sentBody = JSON.parse(commentCall.options.body);
  assert.equal(sentBody.body.type, 'doc');
  assert.ok(JSON.stringify(sentBody.body).includes('ProofDesk verdict'));
});

test('service runs end to end over ForgeJiraClient with the stub transport', async () => {
  const transport = stubTransport();
  const service = createProofDeskService({
    jira: new ForgeJiraClient(transport),
    registry: new InMemoryRegistry(),
    now,
  });
  const run = await service.runVerificationForIssue('FIN-101');
  // Only the invoice is attached; the delivery note is missing.
  assert.equal(run.verdict, VERDICTS.NEEDS_EVIDENCE);
  assert.equal(run.commentId, '555');
  const state = await service.getPanelState('FIN-101');
  assert.equal(state.latestReceipt.id, run.receipt.id);
});

// --- frontend view models --------------------------------------------------------

test('view models shape panel and ledger display data', async () => {
  const { jira, pack } = await seedFakeFromDemoPack();
  const service = createProofDeskService({ jira, registry: new InMemoryRegistry(), now });

  const beforeState = await service.getPanelState('FIN-101');
  const beforeVm = panelViewModel(beforeState);
  assert.equal(beforeVm.hasReceipt, false);
  assert.equal(beforeVm.verifyButton.label, 'Run checks');
  assert.equal(beforeVm.claimLines.find((l) => l.label === 'Amount').value, '1,250.00 USD');
  assert.equal(beforeVm.evidenceRows.length, 2);

  for (const demoCase of pack.cases) {
    await service.runVerificationForIssue(demoCase.claim.issueKey);
  }
  const afterVm = panelViewModel(await service.getPanelState('FIN-101'), { verifying: true });
  assert.equal(afterVm.hasReceipt, true);
  assert.equal(afterVm.receipt.verdict, VERDICTS.VERIFIED);
  assert.equal(afterVm.receipt.tone, 'success');
  assert.equal(afterVm.verifyButton.label, 'Running checks…');
  assert.equal(afterVm.verifyButton.disabled, true);
  assert.equal(afterVm.receipt.checks.length, 3);

  const ledgerVm = ledgerViewModel(await service.listReceipts());
  assert.equal(ledgerVm.rows.length, pack.cases.length);
  assert.equal(ledgerVm.rows[2].verdict, VERDICTS.MISMATCH);
  assert.equal(ledgerVm.rows[2].tone, 'danger');
  assert.equal(ledgerVm.chain.valid, true);
  assert.ok(ledgerVm.chain.label.includes('Chain valid'));
  assert.equal(ledgerVm.isEmpty, false);

  const emptyVm = ledgerViewModel({ receipts: [], chain: verifyChain([]) });
  assert.equal(emptyVm.isEmpty, true);
});
