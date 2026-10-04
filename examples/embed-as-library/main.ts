/**
 * Embed-as-library example: use OpenMimic as a library without starting
 * any server. Creates a subject, records two testimonies, runs the court,
 * and prints the assembled persona prompt.
 *
 * Run with: npx tsx examples/embed-as-library/main.ts
 * Also tested in: examples/embed-as-library/main.test.ts
 */
import { createOpenMimic, witnessPlugin, courtPlugin } from '@openmimic/core';
import { FakeLLM } from '@openmimic/engine-court';
import { assemblePersonaContext } from '@openmimic/kernel';

const FILING_RESPONSE = JSON.stringify({
  episodes: [{ qid: 'q1', text: 'always pays' }],
  claims: [
    { text: 'She always pays for everyone.', kind: 'pattern', evidenceTestimonyIds: ['t-1'] },
  ],
});

export async function run(): Promise<string> {
  const fakeLLM = new FakeLLM([FILING_RESPONSE, FILING_RESPONSE]);

  const om = await createOpenMimic({
    dbPath: ':memory:',
    llm: fakeLLM,
    plugins: [witnessPlugin, courtPlugin],
  });

  try {
    // Create a subject
    om.store.putSubject({ id: 's1', displayName: 'Alice' });

    // Record two testimonies via the witness collector
    const witness = om.get<import('@openmimic/engine-witness').WitnessCollector>('witness');
    const invite = witness.createInvite('s1');
    witness.submitTestimony(invite.token, {
      relation: 'friend',
      consentLevel: 'quotable',
      answers: [{ qid: 'q1', behindText: 'She always pays for everyone.' }],
    });
    const invite2 = witness.createInvite('s1');
    witness.submitTestimony(invite2.token, {
      relation: 'colleague',
      consentLevel: 'quotable',
      answers: [{ qid: 'q1', behindText: 'She picks up every check at lunch.' }],
    });

    // Run the court
    const court = om.get<import('@openmimic/engine-court').CourtEngine>('court');
    await court.runCourt('s1');

    // Assemble the persona
    const persona = await assemblePersonaContext('s1', om.store);
    return persona.systemPrompt;
  } finally {
    await om.dispose();
  }
}

// When run directly, print the result
if (process.argv[1]?.endsWith('main.ts')) {
  const prompt = await run();
  console.log('--- Persona System Prompt ---');
  console.log(prompt);
}
