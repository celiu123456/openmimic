export interface WitnessQuestion {
  qid: string;
  /** The question the witness reads, phrased in plain spoken Chinese. */
  prompt: string;
  /** A gentle nudge shown under the prompt when the witness stalls. */
  followupHint: string;
}

/** A versioned set of questions handed to every witness of one subject. */
export interface Questionnaire {
  id: string;
  title: string;
  /** The追加问句 that produces `frontText` (the "to their face" variant). */
  frontPrompt: string;
  questions: WitnessQuestion[];
}

/**
 * 「朋友版」题库 v1.
 *
 * Ten questions, all from the point of view of a friend describing the person
 * being rebuilt. Every prompt asks for one concrete incident on purpose: a
 * specific story is usable evidence, a bare adjective is not. No jargon — the
 * witness should be able to answer in a group chat without a glossary.
 */
export const FRIEND_V1: Questionnaire = {
  id: 'friend-v1',
  title: '朋友版问卷 v1',
  frontPrompt: '这话你会当他面说吗？会怎么说？',
  questions: [
    {
      qid: 'q1',
      prompt: '你们一起吃饭、买东西的时候，TA 在花钱上是什么样的人？请举一个具体的事，比如谁买的单、有没有借过钱。',
      followupHint: '想想最近一次一起吃饭，最后是谁结的账。',
    },
    {
      qid: 'q2',
      prompt: 'TA 生气或者不高兴的时候是什么样子？请举一个具体的事。',
      followupHint: '比如当众发过火，还是一声不吭。',
    },
    {
      qid: 'q3',
      prompt: '答应你的事，TA 一般能不能做到？请举一个具体的事。',
      followupHint: '迟到、临时变卦，或者说到做到，都算。',
    },
    {
      qid: 'q4',
      prompt: 'TA 平时说话是什么风格？请举一个具体的事。',
      followupHint: '爱开玩笑、说话直，还是话很少？',
    },
    {
      qid: 'q5',
      prompt: 'TA 对陌生人、对服务员是什么态度？请举一个具体的事。',
      followupHint: '点菜、打车、排队时的小事最能看出来。',
    },
    {
      qid: 'q6',
      prompt: '遇到麻烦或者压力大的时候，TA 会怎么办？请举一个具体的事。',
      followupHint: '找人倾诉、自己扛着，还是先想办法？',
    },
    {
      qid: 'q7',
      prompt: '你需要帮忙的时候，TA 通常是什么反应？请举一个具体的事。',
      followupHint: '哪怕是很小的事，只要你想得起来就行。',
    },
    {
      qid: 'q8',
      prompt: 'TA 会怎么对待别人的秘密和隐私？请举一个具体的事。',
      followupHint: '有没有把谁的事说出去过，或者一直守口如瓶。',
    },
    {
      qid: 'q9',
      prompt: 'TA 平时把时间和钱花在什么地方？请举一个具体的事。',
      followupHint: '下班以后、周末都在忙些什么。',
    },
    {
      qid: 'q10',
      prompt: '如果只讲一件事来说明 TA 最真实的一面，你会讲哪一件？请举一个具体的事。',
      followupHint: '不用评价，把事情本身讲清楚就好。',
    },
  ],
};
