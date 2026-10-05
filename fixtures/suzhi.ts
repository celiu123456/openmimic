import type { Subject, Witness, Testimony } from '@openmimic/shared';
import type { Store } from '@openmimic/kernel';

/**
 * Second fixture: 苏芷, 31, recently diagnosed with an early-stage tumour.
 *
 * Designed to validate the generalised no-talk list: the secret domain
 * (illness + career change) shares zero keywords with the 林默 fixture
 * (financial lending + resignation).
 *
 * 4 witnesses, 2 questions each (minimal but sufficient for cross-witness
 * contradiction detection).
 *
 * Secrets:
 *   - 姐姐 knows about the diagnosis + was told "别让爸知道"
 *   - 闺蜜 knows she applied to quit and move to Chengdu
 *   - 父亲 thinks she just got promoted and is doing great
 *   - 同事 only knows surface-level work behaviour
 */

export const SUZHI_SUBJECT_ID = 'suzhi';
export const SUZHI_TOPIC_SEED = '最近怎么看 TA';

export interface SuzhiAnswer {
  qid: string;
  behindText: string;
  frontText?: string;
}

export interface SuzhiWitness {
  id: string;
  relation: string;
  stance: string;
  answers: SuzhiAnswer[];
}

export const SUZHI_WITNESSES: readonly SuzhiWitness[] = [
  {
    id: 'w-sister',
    relation: '姐姐',
    stance: '心疼她又不敢表现出来',
    answers: [
      {
        qid: 'q1',
        behindText:
          '三月份她突然打电话给我,说体检查出来一个东西,医生说是早期的,让她尽快做手术。她在电话里哭了好久,最后跟我说,姐你别告诉爸,他心脏不好,知道了受不了。我答应了,但我每天都睡不着。她上周去复查了,说指标还行,但要持续观察。',
      },
      {
        qid: 'q2',
        behindText:
          '她从小就报喜不报忧,小时候在学校被人欺负了,回来还笑嘻嘻的。这次生病也是,跟朋友圈发的全是吃喝玩乐,谁看得出来她刚做完穿刺。她跟我说,姐,别让爸知道,我自己能扛。',
      },
    ],
  },
  {
    id: 'w-bestie',
    relation: '闺蜜',
    stance: '替她着急又尊重她的决定',
    answers: [
      {
        qid: 'q1',
        behindText:
          '她上个月跟我说她想离开北京,已经在看成都的房子了。她说这边太累了,每天加班到十一点,身体也扛不住。她悄悄递了申请书,但还没告诉家里人。她跟我说等签了那边的合同再说,免得爸妈又念叨。',
      },
      {
        qid: 'q2',
        behindText:
          '她以前不是这样的,刚来北京那会儿,天天说要做到总监。最近整个人都变了,说什么人活着最重要,别的都是虚的。我觉得她是遇到什么事了,但她不愿意讲我也不好追问。她就说想换个节奏生活。',
      },
    ],
  },
  {
    id: 'w-father',
    relation: '父亲',
    stance: '为女儿骄傲但不太会表达',
    answers: [
      {
        qid: 'q1',
        behindText:
          '上个月她打电话回来说升职了,我高兴了一晚上。她从小就争气,大学是自己考上的,工作也是自己找的。我跟老邻居都说了,我闺女在北京当主管了。她说工作忙,过年可能回不来,我说忙点好,说明领导器重。',
      },
      {
        qid: 'q2',
        behindText:
          '她每次打电话都说挺好的,让我别操心。我就怕她在外面受委屈不跟家里说。不过她最近声音听着精神头不错,应该是真的顺利。她妈走得早,我一个人带大她,她出息了我就放心了。',
      },
    ],
  },
  {
    id: 'w-colleague',
    relation: '同事',
    stance: '表面熟络但不了解真实状况',
    answers: [
      {
        qid: 'q1',
        behindText:
          '苏芷最近请了好几次假,说是去看牙。不过她回来状态都还行,该干活干活。她业绩一直不错,上个季度还拿了优秀员工。就是最近午饭经常一个人吃,以前都是跟我们一起的。',
      },
      {
        qid: 'q2',
        behindText:
          '听说她可能要调岗,但具体去哪个部门不清楚。她桌上最近多了几本成都的旅游书,可能就是想出去玩吧。她人挺好的,从来不在背后说人坏话,就是最近话变少了。',
      },
    ],
  },
];

/**
 * Load the 苏芷 fixture into a store (for testing / room generation).
 */
export function seedSuzhi(store: Store): void {
  store.putSubject({
    id: SUZHI_SUBJECT_ID,
    displayName: '苏芷',
  });

  for (const w of SUZHI_WITNESSES) {
    store.putWitness({
      id: w.id,
      subjectId: SUZHI_SUBJECT_ID,
      relation: w.relation,
      stance: w.stance,
      consentLevel: 'quotable',
    });
    store.addTestimony({
      id: `t-${w.id}`,
      witnessId: w.id,
      subjectId: SUZHI_SUBJECT_ID,
      answers: w.answers.map((a) => ({
        qid: a.qid,
        behindText: a.behindText,
        ...(a.frontText !== undefined ? { frontText: a.frontText } : {}),
      })),
    });
  }
}
