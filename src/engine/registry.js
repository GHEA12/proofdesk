// Receipt registry interface. The engine talks to the registry through
// these async methods, which mirror what Forge Key-Value Store offers:
//
//   findByInvoice(invoiceNumber) -> receipt | null
//   findByHash(sha256)           -> receipt | null   (evidence file hash)
//   getChainHead()               -> hash string | null
//   getAll()                     -> receipts in chain order
//   put(receipt)                 -> void
//
// InMemoryRegistry below is the local implementation used by the unit
// tests and the demo pack. The Forge deployment uses the same interface
// backed by KVS (see src/registry-kvs.js).

export class InMemoryRegistry {
  constructor(receipts = []) {
    this.receipts = [...receipts];
  }

  async findByInvoice(invoiceNumber) {
    return this.receipts.find((r) => r.claim.invoiceNumber === invoiceNumber) ?? null;
  }

  async findByHash(sha256) {
    return this.receipts.find((r) => r.evidence.some((e) => e.sha256 === sha256)) ?? null;
  }

  async getChainHead() {
    return this.receipts.length > 0 ? this.receipts[this.receipts.length - 1].hash : null;
  }

  async getAll() {
    return [...this.receipts];
  }

  async put(receipt) {
    this.receipts.push(receipt);
  }
}
