// ProofDesk check engine — unit tests (Node's built-in test runner).
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sha256Hex,
  canonicalStringify,
  checkCompleteness,
  checkAmountConsistency,
  checkDuplicate,
  buildReceipt,
  verifyChain,
  renderReceiptComment,
  InMemoryRegistry,
  runVerification,
  VERDICTS,
} from '../src/engine/index.js';

const NOW = '2026-11-27T00:00:00.000Z';

function deliveryNoteBytes({ total = 1250, lines = null, poReference = 'PO-1001', currency = 'USD' } = {}) {
  const lineItems = lines ?? [
    { description: 'Pallets', quantity: 10, unitPrice: 100, total: 1000 },
    { description: 'Surcharge', quantity: 1, unitPrice: 250, total: 250 },
  ];
  return Buffer.from(
    JSON.stringify({ noteNumber: 'DN-T', poReference, currency, total, lineItems }),
    'utf8',
  );
}

const cleanClaim = {
  issueKey: 'FIN-101',
  claimType: 'vendor-delivery',
  amount: 1250,
  currency: 'USD',
  vendor: 'Acme Logistics',
  invoiceNumber: 'INV-2026-001',
  poReference: 'PO-1001',
};
const cleanPO = { reference: 'PO-1001', amount: 1250, currency: 'USD', vendor: 'Acme Logistics' };
const cleanEvidence = () => [
  { name: 'invoice.txt', type: 'invoice', bytes: Buffer.from('invoice bytes') },
  { name: 'note.json', type: 'delivery-note', bytes: deliveryNoteBytes() },
];

// --- hashing / canonical form -------------------------------------------

test('sha256Hex matches the published SHA-256 test vector for "abc"', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(sha256Hex(Buffer.from('abc')), sha256Hex('abc'));
});

test('canonicalStringify is independent of object key order', () => {
  const a = canonicalStringify({ b: 1, a: { d: [1, 2], c: 'x' } });
  const b = canonicalStringify({ a: { c: 'x', d: [1, 2] }, b: 1 });
  assert.equal(a, b);
});

// --- completeness --------------------------------------------------------

test('completeness passes when all required evidence and the PO reference are present', () => {
  const check = checkCompleteness(
    { claimType: 'vendor-delivery', poReference: 'PO-1001' },
    cleanEvidence(),
  );
  assert.equal(check.status, 'pass');
});

test('completeness fails and names the missing delivery note', () => {
  const check = checkCompleteness(
    { claimType: 'vendor-delivery', poReference: 'PO-1001' },
    [{ name: 'invoice.txt', type: 'invoice', bytes: Buffer.from('x') }],
  );
  assert.equal(check.status, 'fail');
  assert.ok(check.details.some((d) => d.includes('missing: delivery-note')));
});

test('completeness fails when a PO-backed claim type has no PO reference', () => {
  const check = checkCompleteness(
    { claimType: 'contractor-milestone', poReference: null },
    [
      { name: 'i', type: 'invoice', bytes: Buffer.from('x') },
      { name: 's', type: 'sign-off', bytes: Buffer.from('y') },
    ],
  );
  assert.equal(check.status, 'fail');
  assert.ok(check.details.some((d) => d.includes('PO reference missing')));
});

test('expense claims need a receipt and no PO', () => {
  const check = checkCompleteness(
    { claimType: 'expense', poReference: null },
    [{ name: 'r', type: 'receipt', bytes: Buffer.from('x') }],
  );
  assert.equal(check.status, 'pass');
});

test('completeness fails on an unknown claim type', () => {
  const check = checkCompleteness({ claimType: 'mystery', poReference: null }, []);
  assert.equal(check.status, 'fail');
});

// --- amount consistency --------------------------------------------------

test('amount consistency passes when claim, PO, and delivery note all agree', () => {
  const check = checkAmountConsistency(
    { amountCents: 125000, currency: 'USD', vendor: 'Acme Logistics', poReference: 'PO-1001' },
    { reference: 'PO-1001', amountCents: 125000, currency: 'USD', vendor: 'Acme Logistics' },
    cleanEvidence(),
  );
  assert.equal(check.status, 'pass');
});

test('amount consistency fails on a currency mismatch with the PO', () => {
  const check = checkAmountConsistency(
    { amountCents: 125000, currency: 'EUR', vendor: 'Acme Logistics', poReference: 'PO-1001' },
    { reference: 'PO-1001', amountCents: 125000, currency: 'USD', vendor: 'Acme Logistics' },
    [],
  );
  assert.equal(check.status, 'fail');
  assert.ok(check.details.some((d) => d.includes('Currency mismatch')));
});

test('amount consistency fails when the claim exceeds the PO amount', () => {
  const check = checkAmountConsistency(
    { amountCents: 130000, currency: 'USD', vendor: 'Acme Logistics', poReference: 'PO-1001' },
    { reference: 'PO-1001', amountCents: 125000, currency: 'USD', vendor: 'Acme Logistics' },
    [],
  );
  assert.equal(check.status, 'fail');
  assert.ok(check.details.some((d) => d.includes('Amount mismatch')));
});

test('amount consistency catches a delivery-note line arithmetic error', () => {
  const badLines = [
    { description: 'Pallets', quantity: 10, unitPrice: 100, total: 999 },
    { description: 'Surcharge', quantity: 1, unitPrice: 250, total: 250 },
  ];
  const check = checkAmountConsistency(
    { amountCents: 124900, currency: 'USD', vendor: 'Acme Logistics', poReference: 'PO-1001' },
    null,
    [{ name: 'note.json', type: 'delivery-note', bytes: deliveryNoteBytes({ total: 1249, lines: badLines }) }],
  );
  assert.equal(check.status, 'fail');
  assert.ok(check.details.some((d) => d.includes('arithmetic error')));
});

test('amount consistency catches a delivery note whose total disagrees with the claim', () => {
  const check = checkAmountConsistency(
    { amountCents: 120000, currency: 'USD', vendor: 'Acme Logistics', poReference: 'PO-1001' },
    null,
    cleanEvidence(),
  );
  assert.equal(check.status, 'fail');
  assert.ok(check.details.some((d) => d.includes('does not match the claimed amount')));
});

test('amount consistency is skipped when there is nothing to compare against', () => {
  const check = checkAmountConsistency(
    { amountCents: 5000, currency: 'USD', vendor: 'Cafe', poReference: null },
    null,
    [{ name: 'r', type: 'receipt', bytes: Buffer.from('x') }],
  );
  assert.equal(check.status, 'skipped');
});

// --- duplicate detection -------------------------------------------------

test('duplicate detection flags an invoice already receipted on another issue', async () => {
  const registry = new InMemoryRegistry();
  await runVerification({
    claim: cleanClaim, poRecord: cleanPO, evidenceFiles: cleanEvidence(), registry, now: NOW,
  });
  const check = await checkDuplicate(
    { issueKey: 'FIN-103', invoiceNumber: 'INV-2026-001' },
    [],
    registry,
  );
  assert.equal(check.status, 'fail');
  assert.ok(check.details.some((d) => d.includes('Duplicate invoice')));
});

test('duplicate detection flags an evidence file hash receipted on another issue', async () => {
  const registry = new InMemoryRegistry();
  await runVerification({
    claim: cleanClaim, poRecord: cleanPO, evidenceFiles: cleanEvidence(), registry, now: NOW,
  });
  const check = await checkDuplicate(
    { issueKey: 'FIN-199', invoiceNumber: 'INV-NEW' },
    [{ name: 'invoice.txt', type: 'invoice', sha256: sha256Hex(Buffer.from('invoice bytes')) }],
    registry,
  );
  assert.equal(check.status, 'fail');
  assert.ok(check.details.some((d) => d.includes('Duplicate evidence file')));
});

test('re-running checks on the same issue is not a duplicate', async () => {
  const registry = new InMemoryRegistry();
  await runVerification({
    claim: cleanClaim, poRecord: cleanPO, evidenceFiles: cleanEvidence(), registry, now: NOW,
  });
  const check = await checkDuplicate(
    { issueKey: 'FIN-101', invoiceNumber: 'INV-2026-001' },
    [{ name: 'invoice.txt', type: 'invoice', sha256: sha256Hex(Buffer.from('invoice bytes')) }],
    registry,
  );
  assert.equal(check.status, 'pass');
});

// --- receipts and the hash chain ----------------------------------------

test('receipts chain: the second receipt links to the first hash and the chain verifies', async () => {
  const registry = new InMemoryRegistry();
  const first = await runVerification({
    claim: cleanClaim, poRecord: cleanPO, evidenceFiles: cleanEvidence(), registry, now: NOW,
  });
  const second = await runVerification({
    claim: { ...cleanClaim, issueKey: 'FIN-102', invoiceNumber: 'INV-2026-002' },
    poRecord: cleanPO,
    evidenceFiles: cleanEvidence(),
    registry,
    now: NOW,
  });
  assert.equal(first.receipt.prevHash, null);
  assert.equal(second.receipt.prevHash, first.receipt.hash);
  const chain = verifyChain(await registry.getAll());
  assert.equal(chain.valid, true);
  assert.equal(chain.checked, 2);
});

test('verifyChain detects a tampered receipt', async () => {
  const registry = new InMemoryRegistry();
  await runVerification({
    claim: cleanClaim, poRecord: cleanPO, evidenceFiles: cleanEvidence(), registry, now: NOW,
  });
  const receipts = await registry.getAll();
  const tampered = { ...receipts[0], verdict: VERDICTS.VERIFIED + ' (edited)' };
  const chain = verifyChain([tampered]);
  assert.equal(chain.valid, false);
  assert.equal(chain.firstInvalidIndex, 0);
});

test('verifyChain detects a broken link', () => {
  const base = {
    claim: {
      issueKey: 'FIN-1', claimType: 'expense', amountCents: 100, currency: 'USD',
      vendor: 'Cafe', invoiceNumber: 'INV-1', poReference: null,
    },
    evidence: [],
    checks: [],
    verdict: VERDICTS.VERIFIED,
    timestamp: NOW,
  };
  const r1 = buildReceipt({ ...base, prevHash: null });
  const r2 = buildReceipt({ ...base, prevHash: 'deadbeef' });
  const chain = verifyChain([r1, r2]);
  assert.equal(chain.valid, false);
  assert.equal(chain.firstInvalidIndex, 1);
});

test('renderReceiptComment includes the verdict, receipt id, and chain link', async () => {
  const registry = new InMemoryRegistry();
  const { receipt } = await runVerification({
    claim: cleanClaim, poRecord: cleanPO, evidenceFiles: cleanEvidence(), registry, now: NOW,
  });
  const text = renderReceiptComment(receipt);
  assert.ok(text.includes(`ProofDesk receipt ${receipt.id}`));
  assert.ok(text.includes('Verdict: VERIFIED'));
  assert.ok(text.includes(`Receipt hash: ${receipt.hash}`));
});

// --- orchestrator verdicts ------------------------------------------------

test('a clean claim verifies', async () => {
  const registry = new InMemoryRegistry();
  const { verdict } = await runVerification({
    claim: cleanClaim, poRecord: cleanPO, evidenceFiles: cleanEvidence(), registry, now: NOW,
  });
  assert.equal(verdict, VERDICTS.VERIFIED);
});

test('a claim missing its delivery note needs evidence', async () => {
  const registry = new InMemoryRegistry();
  const { verdict, checks } = await runVerification({
    claim: cleanClaim,
    poRecord: cleanPO,
    evidenceFiles: [{ name: 'invoice.txt', type: 'invoice', bytes: Buffer.from('invoice bytes') }],
    registry,
    now: NOW,
  });
  assert.equal(verdict, VERDICTS.NEEDS_EVIDENCE);
  assert.equal(checks[0].status, 'fail');
});

test('a duplicate invoice mismatches even when everything else is clean', async () => {
  const registry = new InMemoryRegistry();
  await runVerification({
    claim: cleanClaim, poRecord: cleanPO, evidenceFiles: cleanEvidence(), registry, now: NOW,
  });
  const { verdict, checks } = await runVerification({
    claim: { ...cleanClaim, issueKey: 'FIN-103' },
    poRecord: cleanPO,
    evidenceFiles: [
      { name: 'invoice-copy.txt', type: 'invoice', bytes: Buffer.from('retyped invoice') },
      { name: 'note.json', type: 'delivery-note', bytes: deliveryNoteBytes() },
    ],
    registry,
    now: NOW,
  });
  assert.equal(verdict, VERDICTS.MISMATCH);
  assert.equal(checks.find((c) => c.id === 'duplicate').status, 'fail');
});

test('verdict precedence: incomplete evidence beats a duplicate (NEEDS EVIDENCE first)', async () => {
  const registry = new InMemoryRegistry();
  await runVerification({
    claim: cleanClaim, poRecord: cleanPO, evidenceFiles: cleanEvidence(), registry, now: NOW,
  });
  const { verdict } = await runVerification({
    claim: { ...cleanClaim, issueKey: 'FIN-105' },
    poRecord: cleanPO,
    evidenceFiles: [{ name: 'invoice-copy.txt', type: 'invoice', bytes: Buffer.from('retyped invoice') }],
    registry,
    now: NOW,
  });
  assert.equal(verdict, VERDICTS.NEEDS_EVIDENCE);
});

// --- the seeded demo pack --------------------------------------------------

test('the seeded demo pack reproduces all of its expected verdicts', async () => {
  const demoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo');
  const pack = JSON.parse(await readFile(path.join(demoDir, 'pack.json'), 'utf8'));
  const poByReference = new Map(pack.purchaseOrders.map((po) => [po.reference, po]));
  const registry = new InMemoryRegistry();

  for (const demoCase of pack.cases) {
    const evidenceFiles = [];
    for (const item of demoCase.evidence) {
      evidenceFiles.push({
        name: item.name,
        type: item.type,
        bytes: await readFile(path.join(demoDir, item.file)),
      });
    }
    const { verdict, checks } = await runVerification({
      claim: demoCase.claim,
      poRecord: poByReference.get(demoCase.claim.poReference) ?? null,
      evidenceFiles,
      registry,
      now: NOW,
    });
    assert.equal(verdict, demoCase.expectedVerdict, `${demoCase.id} verdict`);
    if (demoCase.expectedFailingCheck) {
      assert.equal(
        checks.find((c) => c.id === demoCase.expectedFailingCheck).status,
        'fail',
        `${demoCase.id} failing check`,
      );
    }
  }

  const chain = verifyChain(await registry.getAll());
  assert.equal(chain.valid, true);
  assert.equal(chain.checked, pack.cases.length);
});
