/**
 * Prints the merged configuration tree to stdout.
 * Usage: npx tsx scripts/config-dump.ts
 */
import { loadConfig, dumpConfig } from '@openmimic/kernel';

const config = loadConfig();
process.stdout.write(dumpConfig(config));
