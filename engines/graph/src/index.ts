export { graphPlugin, type GraphPluginConfig } from './plugin';
export { GraphEngine, type GraphEngineConfig, type RecomputeReport, DEFAULT_CONFIG } from './graph';
export { DependencyTracker, type DependencyRecord, type PersonaVersionRecord, type OutputVersionRecord } from './deps';
export { DirtyTracker, type DirtyMark, type DirtyReason } from './dirty';
export { matchClaims, bigramJaccard, type ClaimMatchResult, type ClaimFate, type SemanticMatcher } from './matcher';
