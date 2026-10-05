/**
 * Twin-2K-500 dataset adapter (A1).
 *
 * Converts a participant's self-report survey data from the Twin-2K-500
 * dataset (Toubia et al., arXiv 2505.17479, CC BY 4.0) into an OpenMimic
 * "self-report" input, reserves a held-out portion as evaluation questions,
 * and runs the "self-report assembled persona predicts held-out answers" flow.
 *
 * Dataset schema (from HuggingFace LLM-Digital-Twin/Twin-2K-500):
 *   - full_persona split:
 *     - pid: string (participant ID)
 *     - persona_text: string (~130K chars, all survey responses as text)
 *     - persona_summary: string (~15K chars, condensed overview)
 *     - persona_json: string (~170K chars, JSON-structured survey data)
 *   - wave_split split:
 *     - pid: string
 *     - wave1_3_persona_text: string (waves 1-3 responses as text — training)
 *     - wave1_3_persona_json: string (same in JSON)
 *     - wave4_Q_wave1_3_A: string (wave 4 questions with wave 1-3 answers — persona)
 *     - wave4_Q_wave4_A: string (wave 4 questions with wave 4 answers — ground truth)
 *   - question_catalog.json: 256 unique question IDs with metadata
 *   - wave1_3_response.csv: 2058 × 761 (numeric)
 *   - wave4_response.csv: 2058 × 127 (numeric)
 *
 * License: CC BY 4.0. Citation:
 *   Toubia, O., Gui, G. Z., Peng, T., Merlau, D. J., Li, A., & Chen, H.
 *   (2025). Twin-2K-500. Marketing Science (forthcoming).
 *
 * Metrics:
 *   - The paper reports accuracy as % of held-out (wave 4) multiple-choice
 *     questions where the LLM-simulated answer matches the participant's
 *     actual answer. Their baseline: GPT-4o with persona_text => ~44% accuracy
 *     (vs random ~21% for 5-option, ~25% for 4-option questions).
 *   - Our comparable metric: for each held-out question, assemble a persona
 *     from the self-report text, predict the answer, compare to ground truth.
 *     Report accuracy and correlation.
 *
 * Known incompatibilities:
 *   - OpenMimic's court/persona system is designed for Chinese text and
 *     multi-witness testimony, not English self-report survey data.
 *   - The judge prompt, prediction prompts, and all rubrics are in Chinese.
 *   - Twin-2K-500 questions are multiple-choice; OpenMimic predictions are
 *     free-text. Direct accuracy comparison requires a format adapter.
 *   - selfReport in OpenMimic is a brief first-person summary (1-2 sentences),
 *     not 130K chars of survey responses. We must truncate/summarize.
 */

import type { LLMClient, LLMCompletionRequest } from '@openmimic/engine-court';
import type { Subject } from '@openmimic/shared';

/* ------------------------------------------------------------------ */
/* Types for the adapter                                               */
/* ------------------------------------------------------------------ */

export interface Twin2KQuestion {
  qid: string;
  questionText: string;
  options: string[];
  correctAnswer: string;  // the participant's actual answer
  correctIndex: number;   // 0-based index of correct option
}

export interface Twin2KParticipant {
  pid: string;
  /** Self-report text used to build the persona (waves 1-3). */
  personaText: string;
  /** Held-out questions for evaluation (wave 4). */
  heldOutQuestions: Twin2KQuestion[];
}

export interface Twin2KPrediction {
  qid: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
  correctIndex: number;
  predictedAnswer: string;
  predictedIndex: number;
  correct: boolean;
}

export interface Twin2KResult {
  pid: string;
  predictions: Twin2KPrediction[];
  accuracy: number;
  totalQuestions: number;
  correctCount: number;
}

/* ------------------------------------------------------------------ */
/* Self-report to OpenMimic subject                                    */
/* ------------------------------------------------------------------ */

/**
 * Convert Twin-2K-500 persona text into an OpenMimic Subject with selfReport.
 * Truncates to maxChars if needed (the full text is ~130K chars).
 */
export function twin2kToSubject(
  participant: Twin2KParticipant,
  maxChars: number = 6000,
): Subject {
  const truncated = participant.personaText.length > maxChars
    ? participant.personaText.slice(0, maxChars) + '\n[... truncated ...]'
    : participant.personaText;

  return {
    id: `twin2k-${participant.pid}`,
    displayName: `Participant ${participant.pid}`,
    selfReport: truncated,
  };
}

/* ------------------------------------------------------------------ */
/* Prediction with self-report persona                                 */
/* ------------------------------------------------------------------ */

const PREDICT_SYSTEM = [
  'You are simulating a specific person based on their self-reported survey responses.',
  'Given their self-description and a multiple-choice question, predict which answer',
  'this person would choose. Reply with ONLY the letter (A, B, C, D, or E) of the option',
  'that best matches what this person would answer based on their self-report.',
  'Do not explain your reasoning. Just output the single letter.',
].join('\n');

/**
 * Predict a participant's answer to a held-out question using their self-report.
 */
export async function predictTwin2KAnswer(
  llm: LLMClient,
  personaText: string,
  question: Twin2KQuestion,
): Promise<Twin2KPrediction> {
  const optionLetters = ['A', 'B', 'C', 'D', 'E'];
  const optionLines = question.options.map((opt, i) =>
    `${optionLetters[i]}. ${opt}`,
  ).join('\n');

  const user = [
    '## Self-report (this person\'s own survey responses)',
    personaText.slice(0, 6000),
    '',
    '## Question',
    question.questionText,
    '',
    '## Options',
    optionLines,
    '',
    'Which option would this person choose? Reply with just the letter.',
  ].join('\n');

  const request: LLMCompletionRequest = { system: PREDICT_SYSTEM, user, purpose: 'eval-predict' };
  const raw = await llm.complete(request);
  const letter = raw.trim().toUpperCase().charAt(0);
  const predictedIndex = optionLetters.indexOf(letter);

  return {
    qid: question.qid,
    questionText: question.questionText,
    options: question.options,
    correctAnswer: question.correctAnswer,
    correctIndex: question.correctIndex,
    predictedAnswer: predictedIndex >= 0 ? question.options[predictedIndex] : raw.trim(),
    predictedIndex: predictedIndex >= 0 ? predictedIndex : -1,
    correct: predictedIndex === question.correctIndex,
  };
}

/**
 * Run the full Twin-2K-500 evaluation for one participant.
 */
export async function runTwin2K(
  llm: LLMClient,
  participant: Twin2KParticipant,
): Promise<Twin2KResult> {
  const predictions: Twin2KPrediction[] = [];

  for (const question of participant.heldOutQuestions) {
    const pred = await predictTwin2KAnswer(llm, participant.personaText, question);
    predictions.push(pred);
  }

  const correctCount = predictions.filter((p) => p.correct).length;
  return {
    pid: participant.pid,
    predictions,
    accuracy: predictions.length > 0 ? correctCount / predictions.length : 0,
    totalQuestions: predictions.length,
    correctCount,
  };
}

/* ------------------------------------------------------------------ */
/* Fabricated test fixtures (for offline testing without the dataset)   */
/* ------------------------------------------------------------------ */

/**
 * Create fabricated Twin-2K-500 participants for offline testing.
 * These are NOT real data — they verify the adapter pipeline only.
 */
export function fabricatedTwin2KParticipants(): Twin2KParticipant[] {
  return [
    {
      pid: 'FAKE-001',
      personaText: [
        'Q: How often do you exercise? A: I exercise 5-6 times per week, mainly running and swimming.',
        'Q: How do you handle stress? A: I prefer to be alone and go for a long run.',
        'Q: Are you more introverted or extroverted? A: Definitely introverted. I need alone time to recharge.',
        'Q: How important is financial security? A: Very important. I save at least 30% of my income.',
        'Q: What motivates you at work? A: Learning new things and solving complex problems.',
      ].join('\n'),
      heldOutQuestions: [
        {
          qid: 'fake-q1',
          questionText: 'When you feel overwhelmed, what do you typically do?',
          options: [
            'Talk to friends about it',
            'Go for a run or exercise alone',
            'Watch TV to distract myself',
            'Seek professional help',
          ],
          correctAnswer: 'Go for a run or exercise alone',
          correctIndex: 1,
        },
        {
          qid: 'fake-q2',
          questionText: 'How would you describe your social preferences?',
          options: [
            'I love being the center of attention at parties',
            'I prefer small gatherings with close friends',
            'I enjoy meeting new people constantly',
            'I prefer large social events and networking',
          ],
          correctAnswer: 'I prefer small gatherings with close friends',
          correctIndex: 1,
        },
        {
          qid: 'fake-q3',
          questionText: 'What is your approach to saving money?',
          options: [
            'I spend freely and save what is left',
            'I save a fixed percentage before spending',
            'I do not think about savings much',
            'I invest aggressively with no savings buffer',
          ],
          correctAnswer: 'I save a fixed percentage before spending',
          correctIndex: 1,
        },
      ],
    },
    {
      pid: 'FAKE-002',
      personaText: [
        'Q: How often do you exercise? A: Rarely. I am not a fitness person.',
        'Q: How do you handle stress? A: I talk to my friends and family. Sharing helps.',
        'Q: Are you more introverted or extroverted? A: Very extroverted. I get energy from people.',
        'Q: How important is financial security? A: Not that important. I believe in living for today.',
        'Q: What motivates you at work? A: Recognition and being part of a great team.',
      ].join('\n'),
      heldOutQuestions: [
        {
          qid: 'fake-q1',
          questionText: 'When you feel overwhelmed, what do you typically do?',
          options: [
            'Talk to friends about it',
            'Go for a run or exercise alone',
            'Watch TV to distract myself',
            'Seek professional help',
          ],
          correctAnswer: 'Talk to friends about it',
          correctIndex: 0,
        },
        {
          qid: 'fake-q2',
          questionText: 'How would you describe your social preferences?',
          options: [
            'I love being the center of attention at parties',
            'I prefer small gatherings with close friends',
            'I enjoy meeting new people constantly',
            'I prefer large social events and networking',
          ],
          correctAnswer: 'I love being the center of attention at parties',
          correctIndex: 0,
        },
      ],
    },
    {
      pid: 'FAKE-003',
      personaText: [
        'Q: How often do you exercise? A: I do yoga three times a week and hike on weekends.',
        'Q: How do you handle stress? A: Meditation and journaling. I process things internally.',
        'Q: Are you more introverted or extroverted? A: Ambivert, leaning introvert.',
        'Q: How important is financial security? A: Somewhat important but I value experiences more.',
        'Q: What motivates you at work? A: Making a meaningful impact on people\'s lives.',
      ].join('\n'),
      heldOutQuestions: [
        {
          qid: 'fake-q1',
          questionText: 'When you feel overwhelmed, what do you typically do?',
          options: [
            'Talk to friends about it',
            'Go for a run or exercise alone',
            'Practice meditation or mindfulness',
            'Seek professional help',
          ],
          correctAnswer: 'Practice meditation or mindfulness',
          correctIndex: 2,
        },
      ],
    },
  ];
}
