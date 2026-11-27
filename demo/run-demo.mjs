// ProofDesk demo pack runner. Executes the seeded cases from pack.json,
// in order, against one in-memory receipt registry (the duplicate case
// depends on the clean case having been receipted first), prints each
// verdict next to the expected one, and verifies the receipt chain at
// the end. Exits non-zero if any case disagrees.
//
// Usage: npm run demo   (or: node demo/run-demo.mjs)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { InMemoryRegistry, runVerification, verifyChain } from '../src/engine/index.js';

const demoDir = path.dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(await readFile(path.join(demoDir, 'pack.json'), 'utf8'));

const poByReference = new Map(pack.purchaseOrders.map((po) => [po.reference, po]));
const registry = new InMemoryRegistry();

let failures = 0;
for (const demoCase of pack.cases) {
  const evidenceFiles = [];
  for (const item of demoCase.evidence) {
    const bytes = await readFile(path.join(demoDir, item.file));
    evidenceFiles.push({ name: item.name, type: item.type, bytes });
  }
  const poRecord = demoCase.claim.poReference
    ? poByReference.get(demoCase.claim.poReference) ?? null
    : null;

  const { verdict, checks, receipt } = await runVerification({
    claim: demoCase.claim,
    poRecord,
    evidenceFiles,
    registry,
    now: '2026-11-27T00:00:00.000Z',
  });

  const ok = verdict === demoCase.expectedVerdict;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${demoCase.id}: verdict ${verdict} (expected ${demoCase.expectedVerdict})  receipt ${receipt.id}`,
  );
  for (const check of checks) {
    console.log(`      ${check.label}: ${check.status}`);
  }
}

const chain = verifyChain(await registry.getAll());
console.log(`Chain verification: ${chain.valid ? 'VALID' : 'INVALID'} - ${chain.details.join(' ')}`);
if (!chain.valid) failures += 1;

if (failures > 0) {
  console.error(`Demo pack FAILED: ${failures} disagreement(s).`);
  process.exit(1);
}
console.log('Demo pack OK: all seeded verdicts reproduced.');
