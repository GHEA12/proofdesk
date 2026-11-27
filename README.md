# ProofDesk

**An evidence gate for Jira approvals: the claim is checked before it is approved, and every verdict is a verifiable receipt.**

ProofDesk is a Forge app for Jira, built for Atlassian Codegeist 2026
(Apps for Business Teams, with a Rovo agent for the Best Agents bonus).
It was written by Indra Dwi Junianto.

Teams already run approvals as Jira issues: a vendor claims a delivery,
a contractor claims a milestone, an employee files an expense. The claim
lives in the issue; the evidence lives in attachments and linked records.
Today a human eyeballs the evidence and clicks Approve. ProofDesk checks
first, in one click, with deterministic code:

- **Evidence completeness**: every evidence type the claim type requires
  is attached.
- **Amount consistency**: the claimed amount and currency agree with the
  linked purchase-order record and with machine-readable evidence files.
- **Duplicate detection**: the invoice number and the SHA-256 hashes of
  the evidence files are looked up in a site-wide receipt registry, so
  the same invoice submitted twice is caught.
- **Hash-chained receipt**: every run stores a receipt whose hash chains
  to the previous receipt, so the verification history itself is
  tamper-evident.

The verdict, **VERIFIED**, **NEEDS EVIDENCE**, or **MISMATCH**, is posted
back to the issue as a receipt comment and shown in the issue panel. A
ledger page lists every receipt on the site and can re-verify the whole
chain end to end.

## The Rovo agent

The same check engine is exposed as reusable Forge actions
(`verify-evidence`, `get-receipt`) under a `rovo:agent`, **ProofDesk
Verifier**. Anyone can ask in Rovo Chat, for example "verify the
evidence on FIN-142 and tell me what is missing", and other agents can
invoke the actions as tools. Rovo runs store the receipt but do not post
the comment; the agent reports in chat instead.

## How it works

A claim is an ordinary Jira issue whose description carries a small
plain-text block (human-writable, no custom fields to configure):

```
ProofDesk claim
Type: vendor-delivery
Amount: 1250.00
Currency: USD
Vendor: Acme Logistics
Invoice: INV-2026-001
PO: PO-1001
```

The purchase order is another issue carrying a `ProofDesk purchase
order` block, linked to the claim issue. Evidence files are attached to
the claim issue; the evidence type is read from the file name (for
example `INV-2026-001-invoice.txt`, `DN-2026-001-delivery-note.json`).

Verdict precedence is deterministic and documented:

1. Evidence incomplete: **NEEDS EVIDENCE**
2. Any other check failed: **MISMATCH**
3. Otherwise: **VERIFIED**

**Honest limitation:** ProofDesk verifies the consistency, presence,
and uniqueness of evidence. It does not OCR paper invoices. Amounts are
cross-checked from the structured claim fields, the linked PO record,
and machine-readable evidence files.

## Architecture

- `src/engine/`: the pure check engine (claim model, the checks,
  SHA-256 hashing and canonical serialization, hash-chained receipts,
  the registry interface with an in-memory implementation). No Forge
  imports, no network, fully unit-tested.
- `src/resolver.js`: the app service above the engine (panel state, run
  verification, latest receipt, ledger, chain verification), wired into
  the Forge resolver by `src/index.js`.
- `src/registry-kvs.js`: the production registry on Forge Key-Value
  Store (receipt records, invoice and file-hash duplicate indexes,
  chain head). The same contract tests run against both registries.
- `src/jira-client.js` and `src/forge-jira-client.js`: one Jira client
  interface with an in-memory fake for tests and the production client
  speaking Jira Cloud REST as the app user. `src/forge-api.js` is the
  only module that imports `@forge/api`.
- `src/comment.js`: the verdict comment formatter (bold verdict line,
  Claim / Checks / Evidence / Receipt chain sections, hashes in code
  formatting), converted to ADF by `src/jira-parse.js`.
- `src/rovo.js`: the Rovo action handlers over the same service.
- `src/frontend/`: the UI Kit issue panel (`index.jsx`) and the ledger
  global page (`ledger.jsx`), rendering from the pure, unit-tested view
  models in `viewmodel.js`. `preview.html` and `preview.js` form a
  static harness that renders the same view models from real resolver
  output, for review without a Forge runtime.
- `manifest.yml`: the Forge modules: `jira:issuePanel`,
  `jira:globalPage`, `rovo:agent`, two `action` modules, and the
  resolver functions. Scopes: `storage:app`, `read:jira-work`,
  `write:jira-work`.

## Run it locally

Needs Node 20 or newer. No dependencies are required for the engine,
the tests, or the demo (the `@forge/*` packages in `package.json` are
only needed inside the Forge runtime).

```sh
npm test        # 42 tests: engine (25) + app layer (17)
npm run demo    # the seeded demo pack, verdicts + chain verification
```

The demo pack (`demo/pack.json` plus `demo/evidence/`) is fabricated
sample data that reproduces all three verdicts against one registry, in
order:

- `case-a-verified`: a clean claim, **VERIFIED**
- `case-b-needs-evidence`: delivery note missing, **NEEDS EVIDENCE**
- `case-c-duplicate`: invoice INV-2026-001 submitted a second time,
  **MISMATCH** (duplicate)
- `case-d-amount-mismatch`: claim and delivery note say 1300.00, the PO
  authorizes 1250.00, **MISMATCH** (amount consistency)

## Seed a real Jira site with the demo pack

```sh
npm run seed            # dry run: prints exactly what would be created
npm run seed:apply      # creates it (needs a Jira site and API token)
```

`scripts/seed-demo.mjs` creates the demo project, the two purchase-order
issues, and the four claim issues with their evidence attachments, using
the same description blocks the app parses. The dry run also round-trip
checks every generated description through the production parsers.
`--apply` needs `JIRA_SEED_BASE_URL`, `JIRA_SEED_EMAIL`, and
`JIRA_SEED_API_TOKEN` in the environment; see the script header for
details.

## Free-path note

This app never calls Forge LLM APIs (they have no free allowance). All
checks are deterministic code that runs well inside Forge's free
platform allowances. The only AI layer is Rovo, and Rovo credits are
paid by the installing customer's organization, never by the app.

## Status

Built and tested locally (42 of 42 tests pass, demo pack green). Deploy
(`forge register`, `forge deploy`, install on the developer site) is the
remaining step, followed by the clean-tenant test and submission. The
entry plan lives in the parent folder's PLAN.md.

## License

MIT
