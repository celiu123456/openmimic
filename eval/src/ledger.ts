/**
 * Run logging: writes each eval run to eval/runs/<timestamp>-<kind>.json.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const RUNS_DIR = join(__dirname, '..', 'runs');

export interface RunRecord {
  kind: string;
  modelName: string;
  promptSha: string;
  commitSha: string;
  params: Record<string, unknown>;
  results: Record<string, unknown>;
  details: unknown[];
  timestamp?: string;
}

export function writeRun(record: RunRecord): string {
  mkdirSync(RUNS_DIR, { recursive: true });
  const ts = record.timestamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${ts}-${record.kind}.json`;
  const filepath = join(RUNS_DIR, filename);
  writeFileSync(filepath, JSON.stringify({ ...record, timestamp: ts }, null, 2), 'utf-8');
  return filepath;
}

/**
 * Find the latest calibration run for a given model + prompt SHA.
 * Returns undefined if no matching calibration exists.
 */
export function findCalibrationRun(
  modelName: string,
  promptSha: string,
): (RunRecord & { results: { passed: boolean } }) | undefined {
  if (!existsSync(RUNS_DIR)) return undefined;

  const files = readdirSync(RUNS_DIR)
    .filter((f: string) => f.endsWith('-calibration.json'))
    .sort()
    .reverse();

  for (const file of files) {
    try {
      const content = readFileSync(join(RUNS_DIR, file), 'utf-8');
      const record = JSON.parse(content) as RunRecord;
      if (record.modelName === modelName && record.promptSha === promptSha) {
        return record as RunRecord & { results: { passed: boolean } };
      }
    } catch {
      // skip malformed files
    }
  }
  return undefined;
}

/**
 * Verify that calibration has passed for the given model + prompt SHA.
 * Throws if not calibrated or calibration failed.
 */
export function requireCalibration(modelName: string, promptSha: string): void {
  const cal = findCalibrationRun(modelName, promptSha);
  if (!cal) {
    throw new Error(
      `No calibration found for model="${modelName}" promptSha="${promptSha}". ` +
        'Run eval:calibrate first.',
    );
  }
  if (!cal.results.passed) {
    throw new Error(
      `Calibration for model="${modelName}" did not pass. ` +
        'Cannot run evaluation with a failed calibration.',
    );
  }
}
