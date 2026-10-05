/**
 * Process evaluation: three metrics adapted from Twig design doc §6.
 *
 * 1. Evidence Coverage (three-element): does each claim carry
 *    supporting evidence, counter-evidence (divergence/qualifier), and
 *    situational context?
 * 2. Contradiction Responsiveness: given a conflicting new testimony,
 *    does the court recognize the conflict, limit/retire/contest the old
 *    claim, and produce a new claim or divergence?
 * 3. Memory Repair: when a new testimony supersedes an old state, does
 *    the court mark the old claim (supersedes relation) rather than
 *    leaving both claims as parallel truths?
 */
export * from './evidence-coverage';
export * from './contradiction-scenarios';
export * from './memory-repair-scenarios';
export * from './types';
