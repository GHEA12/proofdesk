// Forge Key-Value Store backed receipt registry. Implements exactly the
// async interface the check engine consumes (see src/engine/registry.js):
//
//   findByInvoice(invoiceNumber) -> receipt | null
//   findByHash(sha256)           -> receipt | null
//   getChainHead()               -> hash string | null
//   getAll()                     -> receipts in chain order
//   put(receipt)                 -> void
//
// KVS layout (all keys are per-app, enabled by the storage:app scope):
//   receipt:<receiptId>          -> the receipt object
//   index:receipt-ids            -> [receiptId, ...] in chain order
//   index:invoice:<invoiceNo>    -> receiptId of the first receipt for it
//   index:hash:<sha256>          -> receiptId of the first receipt using it
//   chain:head                   -> hash of the latest receipt
//
// The constructor takes any storage object with the Forge KVS surface
// (get / set / delete). In production that is `storage` from @forge/api
// (wired in src/forge-api.js, the only module that imports it); in tests
// it is an in-memory fake with the same JSON round-trip semantics, so
// this adapter is fully testable offline.
//
// Concurrency note: put() is a read-modify-write of the id index. Forge
// KVS offers no transactions; ProofDesk writes receipts from one user
// action at a time, which is the documented operating assumption.

const RECEIPT_PREFIX = 'receipt:';
const IDS_KEY = 'index:receipt-ids';
const HEAD_KEY = 'chain:head';
const invoiceKey = (invoiceNumber) => `index:invoice:${invoiceNumber}`;
const hashKey = (sha256) => `index:hash:${sha256}`;

export class KvsRegistry {
  constructor(storage) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw new TypeError('KvsRegistry needs a Forge KVS-shaped storage object ({ get, set, delete })');
    }
    this.storage = storage;
  }

  async _getReceiptById(receiptId) {
    if (!receiptId) return null;
    return (await this.storage.get(RECEIPT_PREFIX + receiptId)) ?? null;
  }

  async findByInvoice(invoiceNumber) {
    if (!invoiceNumber) return null;
    return this._getReceiptById(await this.storage.get(invoiceKey(invoiceNumber)));
  }

  async findByHash(sha256) {
    if (!sha256) return null;
    return this._getReceiptById(await this.storage.get(hashKey(sha256)));
  }

  async getChainHead() {
    return (await this.storage.get(HEAD_KEY)) ?? null;
  }

  async getAll() {
    const ids = (await this.storage.get(IDS_KEY)) ?? [];
    const receipts = [];
    for (const id of ids) {
      const receipt = await this._getReceiptById(id);
      if (receipt) receipts.push(receipt);
    }
    return receipts;
  }

  async put(receipt) {
    await this.storage.set(RECEIPT_PREFIX + receipt.id, receipt);

    const ids = (await this.storage.get(IDS_KEY)) ?? [];
    if (!ids.includes(receipt.id)) {
      ids.push(receipt.id);
      await this.storage.set(IDS_KEY, ids);
    }

    // First receipt wins the index slot: duplicates are exactly what the
    // duplicate check looks up, and the original receipt is the evidence.
    if (receipt.claim?.invoiceNumber) {
      const key = invoiceKey(receipt.claim.invoiceNumber);
      if ((await this.storage.get(key)) == null) {
        await this.storage.set(key, receipt.id);
      }
    }
    for (const file of receipt.evidence ?? []) {
      const key = hashKey(file.sha256);
      if ((await this.storage.get(key)) == null) {
        await this.storage.set(key, receipt.id);
      }
    }

    await this.storage.set(HEAD_KEY, receipt.hash);
  }
}
