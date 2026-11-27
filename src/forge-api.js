// forge-api.js — THE ONLY module in this app that imports @forge/api.
//
// Everything else (engine, resolver, Rovo handlers, KVS registry, Jira
// clients) is written against injected interfaces, so the whole app is
// testable offline. The import here is STATIC and the factories are
// synchronous: production dependencies are plain objects (a KVS-backed
// registry and a Jira client whose transport closures call @forge/api
// per request), so they can be constructed at module load, the standard
// Forge pattern.
//
// History: this module originally loaded @forge/api through a dynamic
// import() behind an async factory, and src/index.js / src/rovo.js
// awaited that chain on first invoke before dispatching. In the
// deployed bundle that left the resolver handler's dispatcher promise
// unsettled forever — frontend invokes never returned and the panel
// and ledger hung on their loading skeletons with no error and no
// function logs. Static imports settle at bundle load; see
// ../EVIDENCE.md ("Panel hang fix", 2026-11-27).
//
// Free-path note: this module wires storage and Jira REST only. There
// is no Forge LLM API usage anywhere in the app, by design (PLAN.md).

import * as forgeApi from '@forge/api';
import { KvsRegistry } from './registry-kvs.js';
import { ForgeJiraClient } from './forge-jira-client.js';

/** Production receipt registry backed by Forge Key-Value Store. */
export function createKvsRegistry() {
  return new KvsRegistry(forgeApi.storage);
}

/** Production Jira client speaking REST as the app user. */
export function createForgeJiraClient() {
  return new ForgeJiraClient({
    requestJira: (routeArg, options) => forgeApi.asApp().requestJira(routeArg, options),
    route: forgeApi.route,
  });
}

/** Production dependency bundle for the resolver and Rovo handlers. */
export function createProductionDeps() {
  return { registry: createKvsRegistry(), jira: createForgeJiraClient() };
}
