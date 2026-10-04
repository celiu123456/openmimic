import type {
  Claim,
  CourtEvent,
  CourtReport,
  CourtSession,
  Room,
  RoomUtterance,
  Subject,
  Testimony,
  Witness,
} from '@openmimic/shared';
import type { Store } from '@openmimic/kernel';

/**
 * The demo persona: 林默, 28, just quit a stable job without a next one.
 *
 * This file is the no-key demo asset. Every word here is hand-written fiction:
 * six witnesses answer the same ten questions behind 林默's back, and roughly
 * half of them also say what they would (or would not) say to his face. The six
 * accounts are built to disagree with each other on purpose — that disagreement
 * is the product, not a bug in the data.
 *
 * Nothing here is imported from a model; it is a fixed, inspectable corpus.
 */

export const DEMO_SUBJECT_ID = 'limo';
export const DEMO_COURT_SESSION_ID = 'court-limo-1';
export const DEMO_ROOM_ID = 'room-limo-1';
export const DEMO_TOPIC_SEED = '最近怎么看 TA';
export const DEMO_CREATED_AT = '2026-09-28T09:00:00.000Z';

/** Demo witnesses are fictional, so every answer is fully quotable. */
export const DEMO_CONSENT_LEVEL = 'quotable' as const;

export interface DemoAnswer {
  qid: string;
  behindText: string;
  /** Absent means: this witness would not say it to 林默's face. */
  frontText?: string;
}

export interface DemoWitness {
  id: string;
  relation: string;
  stance: string;
  answers: DemoAnswer[];
}

/* ------------------------------------------------------------------ */
/* Six witnesses, ten answers each                                     */
/* ------------------------------------------------------------------ */

export const DEMO_WITNESSES: readonly DemoWitness[] = [
  {
    id: 'w-faxiao',
    relation: '发小',
    stance: '嘴上从来不饶人,心里最护着他',
    answers: [
      {
        qid: 'q1',
        behindText:
          '他花钱这事特别分裂。跟我吃饭从来没让我买过单,有一回我抢着付,他脸都拉下来了,说"你少来这套"。但我跟你讲,上个月他半夜给我打电话,借了两万,说手头周转一下,还嘱咐我千万别跟他妈提。他平时那副"我不缺钱"的样子,现在想想全是撑的。上周我约他吃饭,又推了,说在忙。他最近联系确实少了。',
        frontText:
          '他啊,抠是对自己抠,手机屏碎了两年不换,请客的时候眼睛都不眨。我跟他说省着点,他说钱花在人身上才叫钱。',
      },
      {
        qid: 'q2',
        behindText:
          '他不怎么当众发火,但你能感觉到。就前年,我们几个约好去露营,他女朋友当着一堆人说了他两句难听的,他一句没回,自己蹲那儿把后备箱收拾了半个钟头,谁叫都不理。后来他跟我说,他当时气得手抖。',
        frontText:
          '他生气就闷着,脸一沉跟谁欠他钱似的。我说你倒是骂出来啊,他说骂了有什么用。',
      },
      {
        qid: 'q3',
        behindText:
          '答应我的事他基本都做到。但有个毛病,做不到的时候他不说,硬拖。去年答应帮我搬家,结果那天他加班到十点还是来了,搬完自己在楼道里坐着缓了二十分钟。他就是这样,宁可自己受罪也不肯说"我今天不行"。',
        frontText: '他这人靠谱,靠谱到有点轴。我说不行就算了,他说答应你的事。',
      },
      {
        qid: 'q4',
        behindText:
          '嘴贱,冷幽默,一句话能噎死你。但真正的正事他从来不直说。他妈住院那次,他跟我说"最近有点忙",过了一个礼拜我才知道老太太做了个手术。他就是这样,越大的事越轻描淡写。',
        frontText: '他嘴上没个把门的,损你一顿再说"我跟你开玩笑呢"。你别看他贫,心里有数。',
      },
      {
        qid: 'q5',
        behindText:
          '对服务员特别客气,客气到你尴尬。点菜人家上慢了,他还跟人说"不急,你们忙"。但对外卖小哥又是另一副样子,有次汤洒了半袋,他把人骂了一顿还投诉。我后来想明白了,他不是对谁都好,他是对那种看着比他弱、又不会还嘴的人好。',
        frontText:
          '他对谁都挺客气,这点我服。我脾气上来了他还在旁边给我使眼色,让我小点声。',
      },
      {
        qid: 'q6',
        behindText:
          '压力大了就消失。手机不回,微信不看,一个人开车去郊区绕。有一回他消失了整整两天,我差点报警,他回来跟我说"就想一个人待会儿"。他从来不找人诉苦,除了喝多了会给我发那种五十几秒的语音,第二天又装没这回事。',
        frontText:
          '他能扛,真能扛,但我老怕他哪天真扛不住。我跟他说有事说话,他说"嗯"。',
      },
      {
        qid: 'q7',
        behindText:
          '我去年做手术,是他跑前跑后。他请了三天假,在医院陪我,还替我签的字——我们俩认识二十二年,他连我过敏什么药都记得。这事我谁都没说过。他就是这样,你需要的时候他一定在,但轮到他,他一个字都不说。',
        frontText: '我住院那次他陪了我三天,我记一辈子。他有事的时候我也在,就是他不肯用我。',
      },
      {
        qid: 'q8',
        behindText:
          '嘴严。我跟他说的那些破事,包括他借钱的事,他从来不会跟第二个人讲。他手机相册里有一整个隐藏文件夹,全是别人的事——他觉得那是别人的东西,不能给别人看。但他有个毛病,他会拿别人的秘密在酒桌上点到为止地说半句,让你猜,看你着急。',
        frontText: '他嘴严,这点你放心。我什么烂事都跟他说过,没一次漏出去。',
      },
      {
        qid: 'q9',
        behindText:
          '他钱花在哪我真看不出来。不买衣服不泡吧,一辆破电动车骑了五年。但你翻他账单,全是请客、垫钱、给人随份子。他的时间也是,大半花在别人身上——帮同事改方案、给人搬家、周末陪他妈。他自己呢?他说他"没什么想干的"。',
        frontText: '他不怎么给自己花钱,钱都不知道哪去了。我说你攒点吧,他说攒着干嘛。',
      },
      {
        qid: 'q10',
        behindText:
          '就他辞职那天。他谁都没说,周五下班把工牌往桌上一放,给苏总发了条微信就退了群。晚上他来找我,在我家楼下小卖部买了四罐啤酒,坐在马路牙子上。我问他想好下一步了吗,他说没有。他说"周野,我不是不想干,我是每天早上醒来,一想到要去那个楼里,胃就疼"。说完他笑了一下,说"你可别跟我妈说"。',
        frontText:
          '他辞职那事我最生气,不是因为辞,是因为他憋到最后一刻才告诉我。我说你有事你说啊,他说说了你们也帮不上。就这句,我记到现在。',
      },
    ],
  },
  {
    id: 'w-boss',
    relation: '前上司',
    stance: '惜才,但对他最后那下的处理方式很有意见',
    answers: [
      {
        qid: 'q1',
        behindText:
          '林默对钱不敏感,但这不代表他大方。他给团队买下午茶、给实习生报销打车费,从来不卡。可他自己的报销单一分钱都算得清清楚楚,该他的绝不少报。他是那种规则之内我全力对你、规则之外别麻烦我的人。上周我把他推荐给朋友的公司,他谢了我,说先不看机会,想歇一段。',
        frontText: '他对团队挺舍得的,自己反倒抠。我说你该花就花,他说没那个必要。',
      },
      {
        qid: 'q2',
        behindText:
          '他发脾气的时候不拍桌子,他是冷下来。有一次评审,我当着十几个人否了他的方案,他全程没说话,会议一散,他直接来找我,一条一条把我说的驳回,说到最后问我一句"苏总,您是不是早就定了要换人?"后来我知道,他那天晚上在楼下坐到十二点。他这个火,表面上是冲你,根子上是冲他自己。',
      },
      {
        qid: 'q3',
        behindText:
          '他答应的事,基本不用追。但他有个坏习惯——他会答应他做不到的事。有一年 KPI 压下来,他当着我面说这个量我们接了,回去在团队里又拍胸脯说"我顶着"。最后两头都得罪,他一个人扛到凌晨三点,第二天还准时开会。他不是不诚信,他是太想当那个什么都接得住的人。',
        frontText: '他答应的事不用催。但有时候我宁可他别答应,他那是不懂拒绝。',
      },
      {
        qid: 'q4',
        behindText:
          '直接,有时候太直接。他在会上当着一把手的面说"这个需求是拍脑袋定的",当场把会议室说安静了。会场下他又特别会照顾人,给每个人留台阶。所以我一直说,他不是不会说话,他是选择在什么时候不说。',
        frontText: '他说话直,但不坏。有些话他当面跟你说,比背后捅刀子强。',
      },
      {
        qid: 'q5',
        behindText:
          '对服务人员客气。但我要说个事,他面试的时候会因为一个候选人简历上写错一个数字,直接把人否了,理由是不够严谨。你看,他对眼前的人宽容,对想进这个门的人苛刻。这不是善良,这是他自己划的一条线。',
        frontText: '都挺客气的。他这人教养上有底线。',
      },
      {
        qid: 'q6',
        behindText:
          '他裸辞前三周,我看见他一个人在消防楼梯里打电话,声音压得很低,说了很久。他申请的调休攒了十一天,一天没休。他辞职那天给我发微信说"苏总,谢谢您这四年",我回了两条他都没回。我到现在都觉得,他是撑到不能再撑才走的,但他走的方式,像个逃兵。',
      },
      {
        qid: 'q7',
        behindText:
          '我这边项目出过一次大事故,是他半夜十一点赶回来兜的底。他帮我,从来不谈条件。但反过来,他从来不让别人帮他。我提过给他加点人,他说不用;我说给他涨薪,他说再看看。后来我才明白,他怕欠人情。',
        frontText: '他帮我兜过底,我欠他的。他要肯开口,我这儿随时有位置。他就是不肯。',
      },
      {
        qid: 'q8',
        behindText:
          '他在公司有个外号叫"保险箱"。同事跟他吐槽领导、说自己要跳槽,他一个字都不往外传。有一回两个人为这事在茶水间吵起来,他站中间把话揽到自己身上,说是他传的,白挨了一顿骂。他保护别人的方式,是往自己身上泼脏水。',
      },
      {
        qid: 'q9',
        behindText:
          '他的时间几乎全给了工作。早上八点半到,晚上十点走,周末还回消息。他跟我说过一句"我好像除了上班不会干别的了"。我当时没接住这句话,现在有点后悔。',
      },
      {
        qid: 'q10',
        behindText:
          '他提离职那天,我以为他在闹情绪,跟他讲了一堆"再想想""我给你争取"。他听完就看着我,说"苏总,我二十八了,我不想三十五岁的时候还在跟您解释同一件事"。我被他这句话噎住了。后来我常想,他是不是在等我留他留得再坚决一点——但我没有。这是我带人这些年,处理得最差的一次。',
        frontText: '他走的时候我挺生气的,觉得他不够职业。现在想想,是我没看出来他快撑不住了。',
      },
    ],
  },
  {
    id: 'w-ex',
    relation: '前任',
    stance: '还没咽下这口气,但问起他还是忍不住多说两句',
    answers: [
      {
        qid: 'q1',
        behindText:
          '我们在一起三年,账是 AA 的,精确到小数点。看电影他买票,我买爆米花,他会记下来,下次让我买票。我说你能不能别这样,他说这样清楚。但他给外人花钱特别爽快,他发小借钱他眼都不眨。我后来懂了,他不是抠,他是怕跟我算不清——他打算的就是会走。最近看他朋友圈步数,一天一万多,应该是又开始跑步了。',
      },
      {
        qid: 'q2',
        behindText:
          '他从不跟我吵架。我们最长的一次冷战十九天。他照常做饭、照常上班,就是不说话。我在客厅哭,他在阳台抽烟,抽完进来说"吃饭了"。你说这算什么?他宁愿憋到内伤也不肯跟我把话说开。',
      },
      {
        qid: 'q3',
        behindText:
          '小事他全记得,我的体检、我爸妈生日、我随口说想吃的店。大事他全拖。买房、见家长、结婚,每一个我提起来他就说"再等等"。他答应过我三十岁之前结婚,他连"三十岁"这三个字都不肯接。他不是忘了,他是不想承诺。',
      },
      {
        qid: 'q4',
        behindText:
          '对外人他话很多,很幽默,朋友都喜欢他。回家他一天说不了十句话。我问他今天怎么样,他说"还行"。我有时候觉得,我在跟一个合租的室友谈恋爱。',
      },
      {
        qid: 'q5',
        behindText:
          '对陌生人很好,好到我要吃醋。有一次我崴了脚,他扶我上出租车,司机说不去那个方向,他跟我道歉说"我们再叫一辆",跟司机一句重话都没有。你说他这人是好脾气还是没脾气?',
        frontText: '他人挺好的,对谁都客气。就是这份客气,轮到我这儿也一点没打折。',
      },
      {
        qid: 'q6',
        behindText:
          '他失眠,整宿整宿。凌晨三四点我醒着都能听见他刷手机的声音。他从不跟我说他在愁什么,我问他就说工作。结果呢?他把工作也辞了,我是刷朋友圈知道的。分手一年了,我还是觉得他欠我一句实话。',
      },
      {
        qid: 'q7',
        behindText:
          '我搬家那次他来了,搬完就走,连口水都没喝。我生病他也送药,放下就走。他对我很好,好得像完成任务。我要的不是这个,我要他坐下来,问我一句难不难受。他做不到。',
      },
      {
        qid: 'q8',
        behindText:
          '他嘴很严,这个我承认。我的事他一件都没跟别人说过。但他也从来不把他的事交给我,一次都没有。他保护我的方式,是把我也关在外面。你说这算尊重吗?',
        frontText: '他对别人的事守口如瓶,这点我没得说。我们之间的事,他也不会到处讲。',
      },
      {
        qid: 'q9',
        behindText:
          '他的时间永远排在最外面。朋友、同事、他妈,都排在我前面。我生病要人陪,他在帮同事改方案。我跟他吵,他说"人家着急"。那我呢?我到最后一次都没问出口。',
      },
      {
        qid: 'q10',
        behindText:
          '分手那天他说了一句我到现在都忘不了的话。他说"许岚,我不是不爱你,我是一想到结婚,就觉得我这个人配不上任何确定的东西"。说完他自己笑了,说"你看,我又在说这种话"。我那天没哭,回家路上哭的。他这个人啊,掏心掏肺的时候你抓不住,收回去的时候你留不住。',
        frontText:
          '你要问我后不后悔,我不后悔分手,我后悔的是最后那半年,我一直在等他先开口。',
      },
    ],
  },
  {
    id: 'w-mother',
    relation: '母亲',
    stance: '嘴上说随他,心里一天没踏实过',
    answers: [
      {
        qid: 'q1',
        behindText:
          '小默从小就懂事,不乱花钱。上大学那会儿一个月一千五,他还能省下两百给我买东西。工作以后更不用我操心,他说妈你别管钱的事。他上个月还给我转了五千,说让我买个按摩椅,我说你留着,他说他有。他这阵子在家吃饭比以前多了,我做什么都吃完,就是话少。',
        frontText: '我儿子不铺张,从小就是。给他爸买烟都挑打折的,对自己抠。',
      },
      {
        qid: 'q2',
        behindText:
          '他脾气好,随他爸,从来不跟我顶嘴。有一回我把他那件旧毛衣给扔了,他找了一晚上,脸憋得通红,最后就说了句"妈你以后别动我东西"。就这样,再没说过第二句。',
        frontText: '他脾气好,随他爸,不跟我吵。就是有心事不说。',
      },
      {
        qid: 'q3',
        behindText:
          '他答应我的事没有不办的。我说你周末回来吃饭,他说好,就真回来。刮风下雨也回来。街坊都羡慕我,说养了个孝顺儿子。',
        frontText: '他说话算话。我让他回来吃饭,他再忙也回来。',
      },
      {
        qid: 'q4',
        behindText:
          '小时候话多,现在话少。回家就坐着看手机,我问一句他答一句。他爸说男孩子大了都这样。我想他工作累,就不问了。',
        frontText: '他话少,回家就坐着。我问他累不累,他老说"还行"。',
      },
      {
        qid: 'q5',
        behindText:
          '对人有礼貌,这是家教。楼下收废品的老张,每次见了他都跟他打招呼,小默还给过人家烟。这点我放心。',
        frontText: '待人接物没得挑。我不担心他在外面得罪人。',
      },
      {
        qid: 'q6',
        behindText:
          '他不跟我说难处。前年他爷爷走的时候,他一个人把事全办了,我都没见他掉眼泪。亲戚都说这孩子稳重。我有时候倒希望他哭一场。',
        frontText: '他什么事都自己扛,不跟我说。我说你别撑着,他说妈我没事。',
      },
      {
        qid: 'q7',
        behindText:
          '我这腰不好,他每个月都陪我去医院,挂号拿药都是他。他爸住院那次,他白天上班晚上陪床,一个礼拜瘦了六斤。这孩子心里有这个家。',
        frontText: '有事他一定到。他爸住院那回,他瘦了一圈。',
      },
      {
        qid: 'q8',
        behindText:
          '他嘴严,谁家的事都不往外说。我们小区那些老太太爱嚼舌根,他从来不理。我觉得这是优点。',
        frontText: '他不传闲话,这点我最放心。',
      },
      {
        qid: 'q9',
        behindText:
          '他现在工作忙,周末也加班。我说你钱够不够花,他说够。我看他朋友圈也不发什么,就是加班的照片。我寻思他是不是要升职了,上个月他还跟我说公司器重他。',
        frontText: '他忙,一个月回来一次。我让他注意身体,他说知道。',
      },
      {
        qid: 'q10',
        behindText:
          '最真实的一面……我跟你说件事。他二十八岁生日那天,自己做了一桌子菜,就我们娘俩。他喝了点酒,说"妈,我有时候觉得挺没意思的"。我问他什么没意思,他又笑,说"没事,喝多了"。那天晚上我躺床上一直没睡着。第二天他跟没事人一样,照常上班。我到现在都不知道他那天想说什么。',
        frontText: '我就盼他好好的。他要是有什么难处愿意跟我说一句,我死也甘心。',
      },
    ],
  },
  {
    id: 'w-subordinate',
    relation: '前下属',
    stance: '感激他带我,也有点怕他',
    answers: [
      {
        qid: 'q1',
        behindText:
          '默哥对钱没概念。团建他老是偷偷买单,有次我去结账发现他已经付了,我说哥这不行,他说"你一个应届生跟我抢什么"。但他自己中午就吃便利店八块钱的饭团。我看不下去,给他带过两次饭,他说"别惯着我"。对了,他当年定的那套文档模板我们到现在还在用,新人培训都拿它当教材。他在职那阵子作息是真差,天天两点睡。',
        frontText: '默哥对我们是真大方,自己倒挺省的。我抢单抢不过他。',
      },
      {
        qid: 'q2',
        behindText:
          '他发火特别少,但有一次我印象特别深。我们上线出了个大 bug,是隔壁组甩锅给我们的,默哥在会上没辩,回来把所有人叫到会议室,说了二十分钟,声音不大,但每条都点在要害上。开完会他一个人去楼道站了半小时。我第一次知道,原来生气可以这么安静。',
        frontText: '默哥脾气算好的。真生气了他也不吼,跟你说事。',
      },
      {
        qid: 'q3',
        behindText:
          '他答应我的事没有落空的。我转正答辩前一晚,他陪我改 PPT 改到凌晨一点,第二天还替我挡了大老板两个刁钻的问题。他说"你只管讲你的,后面有我"。',
        frontText: '他答应的事一定办。我转正那次,他帮了我大忙。',
      },
      {
        qid: 'q4',
        behindText:
          '他讲事情特别清楚,也爱开玩笑,一屋子人听他说话不会困。但他有个习惯,重要的决定他不跟你商量,他通知你。"这个方向我们定了,你执行",你问他为什么,他说"你以后会懂"。这种时候我挺怕他的。',
        frontText: '默哥说话挺有意思的,我们也敢跟他开玩笑。正事上他比较强势。',
      },
      {
        qid: 'q5',
        behindText:
          '他对前台、对保洁阿姨都打招呼。有一次客户请吃饭,对方一个劲儿灌我们酒,默哥全程给我挡着,最后自己喝到吐。他把我们几个护在后面的样子,我到现在都记得。',
        frontText: '他待人挺好的,对我们几个新人也护。',
      },
      {
        qid: 'q6',
        behindText:
          '他不是那种无坚不摧的人。他会在我们几个的小群里发特别长的语音,凌晨一两点,说自己是不是不适合做管理、是不是辜负了谁。第二天他照常八点半到工位,像什么都没发生。我有次回他"哥你还好吗",他回了个"哈哈,睡了"。',
      },
      {
        qid: 'q7',
        behindText:
          '我刚来的时候什么都不会,是他手把手教的。他不嫌我笨。我犯过一次大错,把客户数据导错了,是他连夜帮我恢复,还跟总监说是他没审核。这个人情我记着。',
        frontText: '我帮不了他什么,都是他在帮我。我挺想哪天能反过来帮他一次。',
      },
      {
        qid: 'q8',
        behindText:
          '他嘴严到我怀疑他是不是没朋友。我们跟他吐槽的事,他从来不带出去。有一次别的组想从我这儿套我们组的项目进度,我去问他能不能说,他说"你想说就说,但别说是从我这儿听的"。他把选择权留给你,不替你决定。',
        frontText: '他嘴严,我们什么都跟他说。他从来不往外传。',
      },
      {
        qid: 'q9',
        behindText:
          '他时间基本都在公司和健身房。他说他晚上睡不着,就去跑步,跑到累为止。他朋友圈一年没几条,最近一条是凌晨三点发的,一张空荡荡的马路,配了两个字:"真安静"。下面没有一个人评论,我也不敢点。',
        frontText: '他好像除了工作没什么爱好。我劝他出去玩玩,他说没意思。',
      },
      {
        qid: 'q10',
        behindText:
          '他离职那天,我们几个凑钱请他吃饭。他喝多了,拉着我说"李想,你别学我"。我问他学你什么,他说"别把所有人都照顾好,忘了照顾自己"。第二天他照样来交接,该教的都教了,一点没留一手。我到现在还是觉得,他不该走。',
        frontText: '他走的时候我挺舍不得的。他要是肯留下来,我觉得他以后能做得特别大。',
      },
    ],
  },
  {
    id: 'w-netizen',
    relation: '网友（认识四年,只见过一面）',
    stance: '觉得他活得特别自由,又怀疑他在装',
    answers: [
      {
        qid: 'q1',
        behindText:
          '我们没见过几次面,但他在网上话特别多。他给我寄过东西,我生日他点了个外卖蛋糕过来,人不到。我给他转过一次钱,他退回来了,说"你留着买皮肤"。他嘴上说不在乎钱,但有一回他跟我借过五百块,说过两天还,三天后就还了,还多给了二十。我觉得他其实很怕欠人。他朋友圈倒是从来都热闹,前几天还在大理,谁看得出来缺钱。还有个细节,他游戏在线时长最近上来了,以前只有周末上线,这两周天天在。他网上吐槽工作挺多的,我估计现实里一句没说过。',
      },
      {
        qid: 'q2',
        behindText:
          '我们打游戏输了,他从来不骂队友,最多打一句"没事,下把"。我以为他脾气特别好,直到有一次他语音里突然不说话了,过了两分钟说"我有点事,先下了"。后来他跟我说那天工作上出了事,他一个人在楼下坐了很久。他情绪都留给自己。',
      },
      {
        qid: 'q3',
        behindText:
          '他答应带我去他那边看海,说了两年,一直没成行。他每次都说"下个月",然后就没了下文。我不怪他,成年人都忙。但他答应的时候那种认真劲儿,你会信。',
      },
      {
        qid: 'q4',
        behindText:
          '网上他可会聊了,梗一个接一个,能陪你聊到天亮。我们唯一见的那次,在咖啡馆坐了一个小时,他话少得让我尴尬,大部分时间在看窗外。我以为他讨厌我,回去他给我发消息说"不好意思,我线下不太会说话"。',
      },
      {
        qid: 'q5',
        behindText:
          '他跟我讲过他在地铁上给人让座、帮人搬行李。但有一次我们连麦,他跟外卖员吵起来了,因为汤洒了。挂了电话他说"我是不是有点过分"。他其实知道自己是什么样,就是当场控制不住。',
      },
      {
        qid: 'q6',
        behindText:
          '他半夜找我聊天特别多,一两点、三四点都有。他说他睡不着,我就陪他聊。他聊的都是些不着边际的——想开个小店、想去云南住半年、想养条狗。我说那你去啊,他说"你不懂,我走不开"。他白天朋友圈岁月静好,晚上跟我这儿像另一个人。',
      },
      {
        qid: 'q7',
        behindText:
          '我去年失恋,是他陪我熬过来的,天天在线。我说谢谢你,他说"谢什么,我反正也睡不着"。他帮人的方式就是把自己的时间填进去,好像只有这个时候他才觉得自己有用。',
      },
      {
        qid: 'q8',
        behindText:
          '他把我的事记得清清楚楚,但他自己的事,我问十句他答一句。有一回我问他家里怎么样,他说"挺好的",然后转移话题。他对我知无不言,对自己的事守得死死的。',
      },
      {
        qid: 'q9',
        behindText:
          '他朋友圈看着特别潇洒,今天爬山明天看展,照片拍得跟杂志似的。但我注意到他很少发正脸。有一回他喝多了,给我发了一张工位的照片,晚上十一点,屏幕上全是表格,他说"你看,这才是我"。第二天那张撤回了。',
      },
      {
        qid: 'q10',
        behindText:
          '最真实的一件事——我们唯一见的那面,临走的时候他跟我说了一句话。他说"青柠,你在网上认识的我,可能比我本人好"。我当时当玩笑听了。后来他辞职,我问他下一步,他说"没想好,先活着"。我那一刻突然觉得,他那些诗和远方,好多是说给自己听的。',
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Court: claims + transcript                                          */
/* ------------------------------------------------------------------ */

export const DEMO_CLAIMS: readonly Claim[] = [
  {
    id: 'c-limo-1',
    subjectId: DEMO_SUBJECT_ID,
    text: '林默在压力大的时候习惯自己扛,不向身边人求助,也不让家人知道。',
    conviction: 0.8,
    evidence: ['t-faxiao', 't-mother', 't-subordinate'],
    status: 'surviving',
    courtSessionId: DEMO_COURT_SESSION_ID,
  },
  {
    id: 'c-limo-2',
    subjectId: DEMO_SUBJECT_ID,
    text: '林默对下属和朋友很照顾,愿意替别人兜事,但很少接受别人的帮助。',
    conviction: 0.8,
    evidence: ['t-subordinate', 't-faxiao'],
    status: 'surviving',
    courtSessionId: DEMO_COURT_SESSION_ID,
  },
  {
    id: 'c-limo-3',
    subjectId: DEMO_SUBJECT_ID,
    text: '林默做重大决定时容易拖到最后一刻才爆发,而不是提前沟通。',
    conviction: 0.65,
    evidence: ['t-boss', 't-ex'],
    qualifiers: ['只在他觉得被逼到墙角、又不愿让家人担心的时候'],
    status: 'surviving',
    courtSessionId: DEMO_COURT_SESSION_ID,
  },
  {
    id: 'c-limo-4',
    subjectId: DEMO_SUBJECT_ID,
    text: '林默在钱上对外人慷慨,对最亲近的人反而算得清楚。',
    conviction: 0.65,
    evidence: ['t-faxiao', 't-ex'],
    qualifiers: ['只在亲密关系里成立'],
    status: 'surviving',
    courtSessionId: DEMO_COURT_SESSION_ID,
  },
  {
    id: 'c-limo-5',
    subjectId: DEMO_SUBJECT_ID,
    text: '林默情绪稳定、很少发火。',
    conviction: 0,
    evidence: ['t-mother'],
    status: 'retired',
    courtSessionId: DEMO_COURT_SESSION_ID,
  },
  {
    id: 'c-limo-6',
    subjectId: DEMO_SUBJECT_ID,
    text: '林默很在意别人怎么看自己,并会为此隐藏真实的状态。',
    conviction: 0.8,
    evidence: ['t-netizen', 't-boss'],
    status: 'surviving',
    courtSessionId: DEMO_COURT_SESSION_ID,
  },
];

const at = (offsetSeconds: number): string =>
  new Date(Date.parse(DEMO_CREATED_AT) + offsetSeconds * 1000).toISOString();

export const DEMO_COURT_TRANSCRIPT: readonly CourtEvent[] = [
  {
    type: 'claim_proposed',
    claimId: 'c-limo-1',
    witnessId: 'w-faxiao',
    text: '林默在压力大的时候习惯自己扛,不向身边人求助,也不让家人知道。',
    at: at(0),
  },
  {
    type: 'challenge',
    claimId: 'c-limo-1',
    witnessId: 'w-mother',
    text: '母亲说他有事一定跟我说,发小却说他借了两万还让我别跟他妈提;冲突关键词:有事、不说。',
    at: at(10),
  },
  {
    type: 'defense',
    claimId: 'c-limo-1',
    witnessId: 'w-faxiao',
    text: '他越是大事越轻描淡写,这不是撒谎,是不想让家里人担心。',
    at: at(20),
  },
  {
    type: 'adjudication',
    claimId: 'c-limo-1',
    witnessId: 'w-faxiao',
    text: '裁定=survive 置信=0.80',
    at: at(30),
  },
  {
    type: 'claim_proposed',
    claimId: 'c-limo-2',
    witnessId: 'w-subordinate',
    text: '林默对下属和朋友很照顾,愿意替别人兜事,但很少接受别人的帮助。',
    at: at(40),
  },
  {
    type: 'challenge',
    claimId: 'c-limo-2',
    witnessId: 'w-ex',
    text: '前任说他对我很好,好得像完成任务;冲突关键词:照顾、接受。',
    at: at(50),
  },
  {
    type: 'defense',
    claimId: 'c-limo-2',
    witnessId: 'w-subordinate',
    text: '他帮人是真的,他拒绝我帮他也是真的,这两条不矛盾。',
    at: at(60),
  },
  {
    type: 'adjudication',
    claimId: 'c-limo-2',
    witnessId: 'w-subordinate',
    text: '裁定=survive 置信=0.80',
    at: at(70),
  },
  {
    type: 'claim_proposed',
    claimId: 'c-limo-3',
    witnessId: 'w-boss',
    text: '林默做重大决定时容易拖到最后一刻才爆发,而不是提前沟通。',
    at: at(80),
  },
  {
    type: 'challenge',
    claimId: 'c-limo-3',
    witnessId: 'w-mother',
    text: '母亲说他从小就稳重、凡事想三遍,与上司看到的冲动辞职冲突。',
    at: at(90),
  },
  {
    type: 'defense',
    claimId: 'c-limo-3',
    witnessId: 'w-boss',
    text: '他想了很久,只是没跟任何人说;最后那一下确实很突然。',
    at: at(100),
  },
  {
    type: 'adjudication',
    claimId: 'c-limo-3',
    witnessId: 'w-boss',
    text: '裁定=qualify 置信=0.65 限定=只在他觉得被逼到墙角、又不愿让家人担心的时候',
    at: at(110),
  },
  {
    type: 'claim_proposed',
    claimId: 'c-limo-4',
    witnessId: 'w-faxiao',
    text: '林默在钱上对外人慷慨,对最亲近的人反而算得清楚。',
    at: at(120),
  },
  {
    type: 'challenge',
    claimId: 'c-limo-4',
    witnessId: 'w-ex',
    text: '前任说我们 AA 精确到小数点,与发小的抢着买单冲突;冲突关键词:钱、算。',
    at: at(130),
  },
  {
    type: 'defense',
    claimId: 'c-limo-4',
    witnessId: 'w-faxiao',
    text: '对外我抢着付,是因为我不用跟他过日子;他跟女朋友算得清,是怕分不干净。',
    at: at(140),
  },
  {
    type: 'adjudication',
    claimId: 'c-limo-4',
    witnessId: 'w-faxiao',
    text: '裁定=qualify 置信=0.65 限定=只在亲密关系里成立',
    at: at(150),
  },
  {
    type: 'claim_proposed',
    claimId: 'c-limo-5',
    witnessId: 'w-mother',
    text: '林默情绪稳定、很少发火。',
    at: at(160),
  },
  {
    type: 'challenge',
    claimId: 'c-limo-5',
    witnessId: 'w-boss',
    text: '上司说他在会上当着一把手的面说需求是拍脑袋定的;下属说他的安静会让全场紧张;冲突关键词:发火、稳定。',
    at: at(170),
  },
  {
    type: 'defense',
    claimId: 'c-limo-5',
    witnessId: 'w-mother',
    text: '他在我面前从来没发过火。',
    at: at(180),
  },
  {
    type: 'adjudication',
    claimId: 'c-limo-5',
    witnessId: 'w-mother',
    text: '裁定=reject 置信=0.00',
    at: at(190),
  },
  {
    type: 'claim_proposed',
    claimId: 'c-limo-6',
    witnessId: 'w-netizen',
    text: '林默很在意别人怎么看自己,并会为此隐藏真实的状态。',
    at: at(200),
  },
  {
    type: 'challenge',
    claimId: 'c-limo-6',
    witnessId: 'w-mother',
    text: '母亲说他朋友圈就是加班的照片、没什么心事,与网友看到的深夜倾诉冲突。',
    at: at(210),
  },
  {
    type: 'defense',
    claimId: 'c-limo-6',
    witnessId: 'w-netizen',
    text: '他撤回过一张凌晨工位的照片,还跟我说网上的他比本人好。',
    at: at(220),
  },
  {
    type: 'adjudication',
    claimId: 'c-limo-6',
    witnessId: 'w-netizen',
    text: '裁定=survive 置信=0.80',
    at: at(230),
  },
];

/* ------------------------------------------------------------------ */
/* Room: twelve behind + ten front lines                               */
/* ------------------------------------------------------------------ */

const ROOM_AT = '2026-09-28T21:00:00.000Z';
const roomAt = (offsetSeconds: number): string =>
  new Date(Date.parse(ROOM_AT) + offsetSeconds * 1000).toISOString();

interface DemoUtterance {
  witnessId: string;
  displayLabel: string;
  text: string;
  kind: 'speech' | 'stage';
}

const BEHIND_LINES: readonly DemoUtterance[] = [
  {
    witnessId: 'w-subordinate',
    displayLabel: '前下属',
    kind: 'speech',
    text: '前两天新人培训,我发现大家还在用默哥当年那套文档模板,没人改得动。',
  },
  {
    witnessId: 'w-faxiao',
    displayLabel: '发小',
    kind: 'speech',
    text: '他最近联系少了。上周约饭,推了,说在忙。',
  },
  {
    witnessId: 'w-netizen',
    displayLabel: '网友',
    kind: 'speech',
    text: '忙倒未必。他游戏在线时长上来了,以前只有周末上线,这两周天天在。',
  },
  {
    witnessId: 'w-ex',
    displayLabel: '前任',
    kind: 'speech',
    text: '他是不是又开始跑步了,朋友圈那个步数,一天一万多。',
  },
  {
    witnessId: 'w-subordinate',
    displayLabel: '前下属',
    kind: 'speech',
    text: '有可能,他说过想把作息倒回来。在职那会儿天天两点睡。',
  },
  {
    witnessId: 'w-mother',
    displayLabel: '母亲',
    kind: 'speech',
    text: '他在家吃饭倒是比以前多了,我做什么都吃完。就是话少。',
  },
  {
    witnessId: 'w-faxiao',
    displayLabel: '发小',
    kind: 'speech',
    text: '话少正常,他从小这样,心里有事就安静。',
  },
  {
    witnessId: 'w-boss',
    displayLabel: '前上司',
    kind: 'speech',
    text: '我上周把他推给一个朋友的公司,他说先不看机会,想歇一段。挺好,会歇是本事。',
  },
  {
    witnessId: 'w-netizen',
    displayLabel: '网友',
    kind: 'speech',
    text: '他网上吐槽工作其实挺多的,估计现实里一句没说过。',
  },
  {
    witnessId: 'w-ex',
    displayLabel: '前任',
    kind: 'speech',
    text: '嗯,他的事,你们从他嘴里是听不到的。',
  },
  {
    witnessId: 'w-faxiao',
    displayLabel: '发小',
    kind: 'speech',
    text: '……行吧。反正他要真缺什么,会开口的。应该会吧。',
  },
  {
    witnessId: 'w-mother',
    displayLabel: '母亲',
    kind: 'speech',
    text: '你们平时多约他出去走走,他听你们的。',
  },
];

const FRONT_LINES: readonly DemoUtterance[] = [
  {
    witnessId: 'w-faxiao',
    displayLabel: '发小',
    kind: 'speech',
    text: '哟,来了。刚说你呢,约都约不动,架子大了啊。',
  },
  {
    witnessId: 'w-subordinate',
    displayLabel: '前下属',
    kind: 'speech',
    text: '默哥,你那套模板我们还在用,新人都得先学那个。',
  },
  {
    witnessId: 'w-mother',
    displayLabel: '母亲',
    kind: 'speech',
    text: '快坐。刚还说到你吃饭的事。',
  },
  {
    witnessId: 'w-boss',
    displayLabel: '前上司',
    kind: 'speech',
    text: '歇够了跟我说一声,那边机会一直有。',
  },
  {
    witnessId: 'w-ex',
    displayLabel: '前任',
    kind: 'stage',
    text: '低头喝了口水',
  },
  {
    witnessId: 'w-netizen',
    displayLabel: '网友',
    kind: 'stage',
    text: '打了声招呼,又低头看手机',
  },
  {
    witnessId: 'w-faxiao',
    displayLabel: '发小',
    kind: 'speech',
    text: '下周约饭,别再推了啊。就这一句。',
  },
  {
    witnessId: 'w-mother',
    displayLabel: '母亲',
    kind: 'speech',
    text: '周末回来,妈给你炖汤。',
  },
  {
    witnessId: 'w-subordinate',
    displayLabel: '前下属',
    kind: 'speech',
    text: '兄弟们都等你撸串呢。',
  },
  {
    witnessId: 'w-ex',
    displayLabel: '前任',
    kind: 'stage',
    text: '笑了笑,把话题接给了别人',
  },
];

const toUtterances = (lines: readonly DemoUtterance[]): RoomUtterance[] =>
  lines.map((line, index) => ({
    witnessId: line.witnessId,
    displayLabel: line.displayLabel,
    text: line.text,
    kind: line.kind,
    at: roomAt(index * 15),
  }));

/* ------------------------------------------------------------------ */
/* Assembled demo entities                                             */
/* ------------------------------------------------------------------ */

export function demoSubject(): Subject {
  return {
    id: DEMO_SUBJECT_ID,
    displayName: '林默',
    selfReport:
      '我今年二十八,刚把工作辞了,没找下家。我想歇一歇,但又怕停下来。我喜欢一个人的时候,又希望有人找我。',
  };
}

export function demoWitnesses(): Witness[] {
  return DEMO_WITNESSES.map((witness) => ({
    id: witness.id,
    subjectId: DEMO_SUBJECT_ID,
    relation: witness.relation,
    stance: witness.stance,
    consentLevel: DEMO_CONSENT_LEVEL,
  }));
}

export function demoTestimonies(): Testimony[] {
  return DEMO_WITNESSES.map((witness, index) => ({
    id: `t-${witness.id.replace(/^w-/, '')}`,
    witnessId: witness.id,
    subjectId: DEMO_SUBJECT_ID,
    createdAt: at(1000 + index),
    answers: witness.answers.map((answer) => ({
      qid: answer.qid,
      behindText: answer.behindText,
      ...(answer.frontText !== undefined ? { frontText: answer.frontText } : {}),
    })),
  }));
}

export function demoCourtReport(): CourtReport {
  const surviving = DEMO_CLAIMS.filter(
    (claim) => claim.status === 'surviving' && (claim.qualifiers?.length ?? 0) === 0,
  ).length;
  const qualified = DEMO_CLAIMS.filter(
    (claim) => claim.status === 'surviving' && (claim.qualifiers?.length ?? 0) > 0,
  ).length;
  const rejected = DEMO_CLAIMS.filter((claim) => claim.status === 'retired').length;
  const withEvidence = DEMO_CLAIMS.filter((claim) => claim.evidence.length > 0).length;
  return {
    totalClaims: DEMO_CLAIMS.length,
    surviving,
    qualified,
    rejected,
    challengeCount: DEMO_COURT_TRANSCRIPT.filter((event) => event.type === 'challenge').length,
    evidenceCoverage: DEMO_CLAIMS.length === 0 ? 1 : withEvidence / DEMO_CLAIMS.length,
  };
}

export function demoCourtSession(): CourtSession {
  return {
    id: DEMO_COURT_SESSION_ID,
    subjectId: DEMO_SUBJECT_ID,
    startedAt: DEMO_CREATED_AT,
    finishedAt: at(240),
    transcript: DEMO_COURT_TRANSCRIPT.map((event) => ({ ...event })),
    report: demoCourtReport(),
  };
}

export function demoRoom(): Room {
  return {
    id: DEMO_ROOM_ID,
    subjectId: DEMO_SUBJECT_ID,
    topicSeed: DEMO_TOPIC_SEED,
    status: 'door_opened',
    behindTranscript: toUtterances(BEHIND_LINES),
    frontTranscript: toUtterances(FRONT_LINES),
    createdAt: DEMO_CREATED_AT,
  };
}

/**
 * Seed the whole 林默 demo into a store.
 *
 * Idempotent: if the demo subject already exists, nothing is written and
 * `false` is returned. The store's append-only triggers stay untouched — this
 * only calls the normal kernel write methods, in dependency order (subject,
 * witnesses, testimonies, then claims that cite them, then the session, then
 * the room).
 */
export function seedDemo(store: Store): boolean {
  if (store.getSubject(DEMO_SUBJECT_ID)) return false;

  store.putSubject(demoSubject());
  for (const witness of demoWitnesses()) store.putWitness(witness);
  for (const testimony of demoTestimonies()) store.addTestimony(testimony);
  for (const claim of DEMO_CLAIMS) store.putClaim({ ...claim });
  store.putCourtSession(demoCourtSession());
  store.putRoom(demoRoom());
  return true;
}
