// Forge resolver entry point (manifest.yml: function `resolver`,
// handler `index.handler`).
//
// The production `handler` is the @forge/resolver definitions object,
// built SYNCHRONOUSLY at module load from the ProofDesk resolver
// definitions (src/resolver.js) over production dependencies
// (src/forge-api.js). This is the standard Forge wiring:
//
//   const resolver = new Resolver();
//   resolver.define('getPanelState', (req) => ...);
//   export const handler = resolver.getDefinitions();
//
// History: the previous version built the dispatcher lazily on first
// invoke behind dynamic import() calls (of ./forge-api.js, @forge/api,
// and @forge/resolver) with a plain-dispatcher fallback. In the
// deployed bundle the dispatcher promise never settled, so frontend
// invokes never returned — the issue panel and the ledger page hung
// on their loading skeletons with no error and no function logs. The
// fallback was also incompatible with the real runtime event shape
// ({ call: { functionKey, payload } }): it read event.functionKey and
// would have thrown "Unknown ProofDesk resolver function: undefined".
// Local reproduction of both defects is recorded in ../EVIDENCE.md
// ("Panel hang fix", 2026-11-27). All dynamic imports are gone.
//
// createHandler(deps) is exported for tests: pass fakes as a plain
// object and the returned handler runs the whole resolver offline
// through a plain dispatcher, invoked with { functionKey, payload } —
// the local convention used by the tests. It also tolerates the real
// runtime event shape ({ call: { functionKey, payload } }).

import resolverPkg from '@forge/resolver';
import { createResolver } from './resolver.js';
import { createProductionDeps } from './forge-api.js';

// @forge/resolver is a CommonJS package whose export shape differs by
// loader: Node ESM hands us module.exports (the Resolver class sits on
// its .default), while the Forge bundler may hand us the class itself.
// Unwrap both, synchronously.
const ResolverCtor =
  typeof resolverPkg === 'function' ? resolverPkg : resolverPkg?.default;

function buildDefinitionsHandler(resolver) {
  const r = new ResolverCtor();
  for (const [key, fn] of Object.entries(resolver.definitions)) {
    r.define(key, async (req) => fn(req?.payload ?? {}));
  }
  return r.getDefinitions();
}

export function createHandler(deps) {
  const resolver = createResolver(deps);
  return async function handler(event) {
    const functionKey = event?.functionKey ?? event?.call?.functionKey;
    const payload = event?.payload ?? event?.call?.payload ?? {};
    return resolver.resolve(functionKey, payload);
  };
}

// Production handler: real @forge/resolver definitions over the
// production dependency bundle, ready before the first invoke.
export const handler = buildDefinitionsHandler(createResolver(createProductionDeps()));
