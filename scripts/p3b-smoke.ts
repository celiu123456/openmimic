/**
 * P3b smoke test: run meta-perception predictions + scoring + gate contest
 * against the 林默 demo data with a real LLM.
 *
 * Usage: cd /home/liuce/code/openmimic-wt/p3b && npx tsx scripts/p3b-smoke.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env manually (no dotenv dependency)
const envPath = resolve(process.cwd(), '.env');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch { /* no .env */ }

import { Store, EventBus, PluginHost, assemblePersonaContext } from '@openmimic/kernel';
import { Router } from '@openmimic/server';
import { OpenAICompatClient } from '@openmimic/engine-court';
import { seedDemo, DEMO_SUBJECT_ID } from '../fixtures/limo';
import {
  metaPerceptionPlugin,
  DEFAULT_META_QIDS,
  scoreOnePrediction,
  computeScore,
  computeByWitness,
  type MetaPerceptionState,
} from '@openmimic/meta-perception';
import {
  gatePlugin,
  contestClaim,
  type GateState,
} from '@openmimic/engine-gate';

async function main() {
  const dbPath = `/tmp/p3b-smoke-${Date.now()}.db`;
  const store = new Store({ path: dbPath });
  console.log(`DB: ${dbPath}`);

  // Seed demo data
  seedDemo(store);
  console.log('Seeded demo data for 林默');

  // Set up plugin system
  const events = new EventBus();
  const host = new PluginHost(events);
  const router = new Router();
  host.providePreset('store', store);
  host.providePreset('events', events);
  host.providePreset('router', router);

  // Check LLM
  const llm = new OpenAICompatClient();
  if (llm.configured && llm.hasApiKey) {
    host.providePreset('llm', llm);
    console.log('LLM configured');
  } else {
    console.log('LLM NOT configured, scoring will be skipped');
  }

  await host.load(metaPerceptionPlugin);
  await host.load(gatePlugin);

  const metaState = host.getService<MetaPerceptionState>('meta-perception');
  const gateState = host.getService<GateState>('gate');

  // ---- Meta-perception: prepare predictions ----
  const witnesses = store.listWitnessesBySubject(DEMO_SUBJECT_ID);
  const testimonies = store.listBySubject(DEMO_SUBJECT_ID);
  console.log(`\nWitnesses: ${witnesses.length}`);
  console.log(`Testimonies: ${testimonies.length}`);

  // Build predictions: deliberately get some right, some wrong
  const predictions: Array<{ witnessId: string; qid: string; predictedText: string }> = [];

  // Deterministic predictions: alternate between close and wrong
  let idx = 0;
  for (const w of witnesses.slice(0, 4)) { // Take 4 witnesses
    for (const qid of DEFAULT_META_QIDS.slice(0, 3)) { // 3 questions each
      const testimony = testimonies.find((t) => t.witnessId === w.id);
      const answer = testimony?.answers.find((a) => a.qid === qid);

      let predicted: string;
      if (!answer) {
        predicted = '不太清楚他会怎么说';
      } else if (idx % 2 === 0) {
        // Close prediction (use first ~20 chars)
        predicted = answer.behindText.slice(0, Math.min(25, answer.behindText.length)) + '大概是这样';
      } else {
        // Wrong prediction
        predicted = '完全相反,他其实不这样';
      }
      predictions.push({ witnessId: w.id, qid, predictedText: predicted });
      idx++;
    }
  }

  // Submit predictions
  metaState.predictions.set(DEMO_SUBJECT_ID, {
    items: predictions,
    lockedAt: new Date().toISOString(),
  });
  console.log(`Submitted ${predictions.length} predictions`);

  // ---- Score with LLM ----
  if (llm.configured && llm.hasApiKey) {
    console.log('\nScoring with LLM...');
    const witnessMap = new Map(witnesses.map((w) => [w.id, w.relation]));

    const items: Array<{ witnessId: string; qid: string; match: 'hit' | 'partial' | 'miss'; cue: string }> = [];
    for (const pred of predictions) {
      const witTestimonies = testimonies.filter((t) => t.witnessId === pred.witnessId);
      let actualText: string | undefined;
      for (const t of witTestimonies) {
        const answer = t.answers.find((a) => a.qid === pred.qid);
        if (answer) { actualText = answer.behindText; break; }
      }
      if (!actualText) {
        items.push({ witnessId: pred.witnessId, qid: pred.qid, match: 'miss', cue: '无对应证言' });
        continue;
      }
      try {
        const result = await scoreOnePrediction(llm, pred.predictedText, actualText);
        items.push({ witnessId: pred.witnessId, qid: pred.qid, ...result });
        console.log(`  ${pred.qid} ${witnessMap.get(pred.witnessId)}: ${result.match} — ${result.cue}`);
      } catch (e) {
        console.log(`  ${pred.qid} ${witnessMap.get(pred.witnessId)}: ERROR — ${e}`);
        items.push({ witnessId: pred.witnessId, qid: pred.qid, match: 'miss', cue: `评分失败: ${e}` });
      }
    }

    const totalScore = computeScore(items);
    const byWitness = computeByWitness(items, witnessMap);

    console.log(`\n=== 元知觉总分: ${(totalScore * 100).toFixed(0)}% ===`);
    console.log('分项:');
    for (const bw of byWitness) {
      console.log(`  ${bw.relation}: ${(bw.score * 100).toFixed(0)}% (${bw.itemCount}题)`);
    }
    console.log('\n逐题判定:');
    for (const item of items) {
      console.log(`  ${item.qid} ${witnessMap.get(item.witnessId)}: ${item.match} — ${item.cue}`);
    }

    metaState.results.set(DEMO_SUBJECT_ID, {
      subjectId: DEMO_SUBJECT_ID,
      totalScore,
      items,
      byWitness,
      scoredAt: new Date().toISOString(),
    });
  } else {
    console.log('\nSkipping scoring (no LLM)');
  }

  // ---- Gate: contest a claim ----
  console.log('\n=== 否决流测试 ===');
  const claims = store.listClaimsBySubject(DEMO_SUBJECT_ID);
  const survivingClaims = claims.filter((c) => c.status === 'surviving');
  console.log(`Surviving claims: ${survivingClaims.length}`);

  if (survivingClaims.length > 0) {
    const target = survivingClaims[0]!;
    console.log(`Contesting claim: "${target.text}" (id: ${target.id})`);

    const record = contestClaim(target.id, store, gateState);
    if (record) {
      console.log(`  Contested at: ${record.at}`);
      console.log(`  Evidence snapshot: ${record.evidenceSnapshot.join(', ')}`);

      // Verify exclusion from persona assembly
      const persona = await assemblePersonaContext(DEMO_SUBJECT_ID, store);
      const excluded = !persona.meta.includedClaimIds.includes(target.id);
      console.log(`  Excluded from persona assembly: ${excluded}`);
    }

    const contested = store.listClaimsBySubject(DEMO_SUBJECT_ID)
      .filter((c) => c.status === 'contested');
    console.log(`  Total contested claims: ${contested.length}`);
  }

  console.log('\n=== Smoke test complete ===');
  store.close();
}

main().catch((e) => {
  console.error('Smoke test failed:', e);
  process.exit(1);
});
