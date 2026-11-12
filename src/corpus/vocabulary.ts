/**
 * 短说法的词表：每个还没判过的短说法（`SHORT_ROUTES`）连同词表里最接近的几个词送进队列，
 * 判定方判它在词表里的位置（和谁是同一件事、属于哪个更宽的词、自成一项，或者不是一项
 * 能力），生效时写进 `term`。
 * 整理只写词表，不碰人身上的词：边上永远是简历里的原话。检索按词表把同一件事的几种
 * 写法当成一条说法（`src/search/phrases.ts`），词表页按宽细把一支词摆出来
 * （`src/server/terms.ts`）。
 * 校验和生效规则见 vocabulary-rules.ts；判定队列在 judgment.ts；模型和外部判定方共用 GUIDE。
 */

import "@tanstack/react-start/server-only";
import { setImmediate } from "node:timers/promises";
import { SHORT_ROUTES } from "#/db/schema";
import type { Rejudge } from "#/lib/task";
import { complete, reviewModel, standardOf } from "#/server/chat";
import { embedConfigured } from "#/server/embed";
import { embed } from "./embed";
import {
	busyWords,
	byJudge,
	collect,
	judged,
	type Member,
	modelJudge,
	openWords,
	promptOf,
	type Question,
	recordJudgments,
	remove,
} from "./judgment";
import type { Report } from "./report";
import type { CorpusClient } from "./session";
import {
	conform,
	type Decision,
	nearest,
	PLACEMENT_SCHEMA,
	place,
	type Table,
	validate,
} from "./vocabulary-rules";

/**
 * 判定的标准。发给自带模型的是它，通过接口交给外部 agent 的也是它
 * （`src/server/review.ts` 的 `guide`）——标准只有一份，改了这段字，
 * 模型和接口读到的都变。
 */
export const GUIDE = `## 背景

这是一个公司内部的人才库。招聘的人和业务负责人要找做过某件事的人：输入一个词搜索，或在筛选栏里点一项，再读这个人简历里的原话确认。每个人的简历被读成几个字的短说法：能力词、做过的事、入职前的岗位名。人身上留的永远是他自己的写法，证据用的都是原话。

词表不改人身上的词，它记三件事：哪些写法是同一件事；一个词属于哪个更宽的词；哪些词说的不是一项能力。同一件事的写法在搜索里互相带出：搜到其中一种，写了另一种的人一起出来。更宽的词是筛选栏里的一项：点它，写了属于它的细词的人一起出来；点细的词时，只写了更宽的词的人不算，因为没法确认他做过细的那件。不是能力的词不出现在筛选栏和搜索的候选词里。这三件事由你来判。

## 判错的代价

- 两件事判成同一件事：搜其中一个会混进不符合要求的人，筛选栏里更精确的那个选项也没了。
- 同一件事判成两件：搜其中一个会漏掉写了另一种写法的人，筛选栏里多一项。
- 归属挂错：筛选栏里点宽的那一项时，写了这个词的人整批算进去，和真正做过的人排在一起。
- 归属漏挂：筛选栏里点宽的那一项时不含它；输入词搜索不受影响，搜索只按字面和同一件事的写法找。
- 能力判成不是能力：筛选栏和候选词里没有它，要找这项能力的人点不到；按字面照样搜得到。
- 不是能力的判成能力：筛选栏和候选词里多一项没人会点的。

合成一项会抹掉一个选项，挂归属不会。所以两个词一个比另一个宽的，用归属表达，不写成同一件事。拿不准是不是同一件事、拿不准属不属于某个更宽的词，都不写，判成自成一项：漏写了按字面照样搜得到，写错了会混进不该有的人。

拿不准指的是这个词有两种常见的读法，按两种读法找出来的是两批人：「方案设计」可以是给客户写售前方案，也可以是做系统的技术设计。只有一种读法、按下面的检验方法能判出来的，就写，不因为这层关系少见、写法生僻而不写。短说法记的都是这个人自己做过的事：「法务培训」是他做过法务方面的培训工作，不按「他参加过培训」去读。

## 任务

下面是一个要判的词，括号里是人数（写了它的人；词表里已经归在它名下的其他写法和更细的词，写了那些的人也算）；后面列着词表里和它写法最接近的几个参考词，人数的算法相同。参考词只是按写法找出来的，可能一个都对不上。回答这个词在词表里的位置，四种里选一种写在 kind：

- 「同一件事」：它和某个参考词是同一件事，target 写那个参考词，原样照抄。
- 「属于」：它是某个更宽的词的一种，target 写那个更宽的词，可以是参考词，也可以由你起名。
- 「自成一项」：它是一项能力，但和参考词都不是同一件事，也说不出它属于哪个更宽的词。target 写空字符串。
- 「不是能力」：它说的不是这个人做过的一项工作或会的一样东西。target 写空字符串。

why 先用一句话说理由，再给 kind 和 target。先看它是不是能力，是能力再看同一件事，不是同一件事再看属于。

## 不是能力

招聘要求里「熟悉 ___」「有 ___ 经验」填不进去的，不是能力：
- 目标、指标和结果：「GMV 目标」「成本下降」。
- 会议、材料、页面这类东西的名字，没说做了哪项工作：「策略会」「周报」「留言板」。
- 谁都会做的泛泛动作：「沟通协调」「问题跟进」。
- 只交代身份、处境或场景的词：「普通员工」「找工作」「三甲医院」。
- 公司、产品、项目、活动的名字。

你看不懂的缩写和行话不在此列：看不出它说的是什么，就判自成一项。它可能是你不熟悉的一门技术或一行里的叫法，判成不是能力会让要找它的人点不到。

带着地名、时间、对象这些限定语的词仍然是能力，它属于去掉限定语之后的那个词：「淡季定价」属于「定价」，「华南区域督导」属于「区域督导」。

## 同一件事

检验方法：招聘要求里写其中一个词，写了另一个词的人完全符合；反过来也完全符合。两个方向都成立才是同一件事，最终用哪个写法由系统按人数定，你不用选。

通常是这几种：大小写、空格、标点不同；中英文或缩写（「推荐算法」「Recommendation」）；同义词（「人员管理」「团队管理」）；语序颠倒而意思不变（「销售策略运营」「销售运营策略」；「活动培训」和「培训活动」意思变了，不算）；多了不改变要找的人的字（「工作」「能力」，「指标体系」和「指标体系搭建」）。

只有一个方向成立的，不是同一件事：
- 一个比另一个细。写了「销售数据分析」的人符合「数据分析」，反过来不成立。细的属于宽的。
- 一个词太笼统，能指好几件事。「开发」可以是写代码，也可以是开发客户、开发课程，它和「代码开发」不是同一件事。
- 岗位名多了级别或带人的字：「高级」「资深」「主管」「总监」。招「X 主管」要的是带过人的，做过 X 的人不一定符合。带级别的岗位名属于不带级别的那个。「X 助理」「X 实习生」是给 X 打下手的另一个职位，不属于「X」这个职位：「律师助理」不是律师。
- 岗位名和它做的那件事。「X 工程师」「X 经理」「X 专员」「X 师」「X 岗」是一个职位，「X」是一件事：招这个职位要的是在这个职位上干过的人，写了做过 X 的人不一定干过这个职位。岗位名属于它做的那件事，不和那件事合成一项：「精算师」「精算岗」属于「精算」。两个岗位名只是叫法不同、级别和职责一样，它们之间才是同一件事：「精算师」「精算岗」。

两个方向都不成立的，更不是：
- 兄弟：去掉限定语后一样。「销售数据分析」和「运营数据分析」找的是两批人，各自属于「数据分析」；「线下门店运营」和「电商店铺运营」对象不同，也是两批人。
- 同一件事里的不同角色或环节。「培训授课」是当讲师，「培训组织」是办培训。
- 邻居。「营销策略」和「运营策略」，「推荐系统」和「搜索推荐」。

## 属于

检验方法：招聘要求里写更宽的词，写了这个词的人都符合。也就是这个词是更宽的词的一种，只是限定了行业、对象、产品、渠道或技术。「销售数据分析」属于「数据分析」，「技术招聘」属于「招聘」，「品牌营销」属于「营销」。「团队培训」不属于「团队管理」，做过培训不等于管过团队；「数据分析报告」不属于「数据分析」，写报告不等于会分析。

分清「是一种」和「用来做」。一个产品、一门技术本身就是更宽的词的一种，就属于它：「PostgreSQL」是一种数据库，属于「数据库」；「Go」是一门编程语言。只是做那件事时用到的环节、产出物、工具、平台，不属于它服务的那项能力：用过 Jira 不等于做过项目管理，会做 PPT 不等于做过方案策划。给某件事做系统、产品或工具，做的是开发或产品，不是那件事本身：「财务系统开发」属于开发，不属于「财务」。业绩结果和指标也不是一件事：「成本下降」「销量提升」说的是做成了什么，没说做了哪项工作，不属于任何一项能力。

按这个人做的是哪一行的活来判，不按两个词共有几个字。几个词拼成的说法，表示「做什么」的那个词决定它属于哪一行，其余的词只说对象、领域或场景：「法务培训」做的是培训，属于「培训」，不属于「法务」；「物流数据分析」做的是数据分析，属于「数据分析」。岗位名里，称呼（经理、专员、工程师）前面的那个词说的是哪一行：「商家运营经理」做的是运营，和「商家经理」「产品经理」共有的字不说明他做过那一行。

更宽的词可以不在参考词里，也可以是简历里没人写过的，由你起名。参考词是按写法找的，所以最常见的更宽的词往往不在里面：按招聘时的行当去想，岗位名属于它所在的那一行。这个名字会成为筛选栏里的一项，也是招聘的人搜索时会输入的词，所以它得是：招聘要求里「熟悉 ___」「有 ___ 经验」能填进去的业务通名，一般不超过八个字，不带动作、程度词，不带「能力」「相关」「工作」这类字。「销售数据分析」的更宽的词写「数据分析」，不写「数据相关」「分析能力」。别的词也在各自起名，用这项能力最通行的叫法，起出来的才会是同一个词。

写最近的一层：「电商销售数据分析」属于「销售数据分析」，不直接写「数据分析」。最近的一层从参考词里找；参考词里没有更近的一层时，直接写这一行的通名，不自己起中间层：「仓储物流数据分析」在参考词里找不到「物流数据分析」时写「数据分析」。更宽的词永远是更宽的那个：「数据分析」不属于「销售数据分析」。`;

/** 找参考词时每找完几个词让出一次事件循环。 */
const YIELD_EVERY = 16;

/** 一个词在词表里的位置这件事此刻的判定标准。队列与外部判定接口都按它隔离版本。 */
export function guideIdentity(): string {
	return standardOf(GUIDE, PLACEMENT_SCHEMA);
}

/**
 * 表被手改坏的几种样子在这里抛错：别名的标准词自己又是别名、归属指向一个别名、
 * 归属成环、有词指向不是能力的词。`place` 不会写出这几种行；静默取其一只会让筛选栏
 * 少一批人而没人知道。
 */
export async function read(client: CorpusClient): Promise<Table> {
	const { rows } = await client.query<{
		word: string;
		canonical: string;
		parent: string | null;
		excluded: boolean;
		reviewed_at: Date | null;
	}>("select word, canonical, parent, excluded, reviewed_at from term");
	const table: Table = new Map(
		rows.map((row) => [
			row.word,
			{
				canonical: row.canonical,
				excluded: row.excluded,
				parent: row.parent,
				reviewedAt: row.reviewed_at,
			},
		]),
	);
	validate(table);
	return table;
}

/**
 * 按决定写入词表，包含判定方命名的父词；同一语句写入父子，外键在语句末尾检查。
 */
async function write(client: CorpusClient, decisions: [string, Decision][]) {
	if (decisions.length === 0) return;
	await client.query(
		`insert into term (word, canonical, parent, excluded, reviewed_at)
		 select * from unnest(
		   $1::text[], $2::text[], $3::text[], $4::boolean[], $5::timestamptz[])
		 on conflict (word) do update
		 set canonical = excluded.canonical,
		     parent = excluded.parent,
		     excluded = excluded.excluded,
		     reviewed_at = excluded.reviewed_at`,
		[
			decisions.map(([word]) => word),
			decisions.map(([, decision]) => decision.canonical),
			decisions.map(([, decision]) => decision.parent),
			decisions.map(([, decision]) => decision.excluded),
			decisions.map(([, decision]) => decision.reviewedAt),
		],
	);
}

/**
 * 让自带的模型判一批词，按入参顺序返回它的原话；答不出一条有效判断的是 undefined
 * （`complete` 已经说过是哪一个）。整理的判定一步和整理质量验收（`scripts/eval-review.ts`）
 * 共用它：验收量的正是这一步，提示词、模型、温度都和整理时一样。
 */
export async function askModel(
	questions: Question[],
	report: Report,
): Promise<(unknown | undefined)[]> {
	const byInput = new Map(questions.map((one) => [promptOf(one), one]));
	const payloads = await complete(
		reviewModel(),
		GUIDE,
		PLACEMENT_SCHEMA,
		[...byInput.keys()],
		"整理",
		report,
		(payload, input) => {
			const asked = byInput.get(input);
			return (
				asked !== undefined &&
				conform(
					payload,
					asked.word,
					asked.near.map((one) => one.word),
				) !== null
			);
		},
	);
	return questions.map((one) => payloads.get(promptOf(one)));
}

/**
 * 此刻有人写的短说法，分两种：标准词（词表里的标准词，加上还没进词表的语料词）各带
 * 它下面的人数，连别名与后代一起数；别名带写了这个写法的人数。
 */
async function vocabulary(client: CorpusClient) {
	const { rows: heads } = await client.query<{ word: string; people: string }>(
		`with recursive head(word) as (
		   select word from term where word = canonical
		   union
		   select p.text from phrase p
		   where exists (select 1 from experience_phrase ep
		                 where ep.phrase_id = p.id and ep.route = any($1::text[]))
		     and not exists (select 1 from term t where t.word = p.text)
		 ), under(term, word) as (
		   select word, word from head
		   union
		   select canonical, word from term where word <> canonical
		   union
		   select u.term, a.word from under u
		   join term c on c.parent = u.word
		   join term a on a.canonical = c.word
		 )
		 select u.term as word, count(distinct e.emp_id) as people
		 from under u
		 join head h on h.word = u.term
		 join phrase p on p.text = u.word
		 join experience_phrase ep on ep.phrase_id = p.id and ep.route = any($1::text[])
		 join experience e on e.id = ep.experience_id
		 group by u.term
		 order by u.term`,
		[[...SHORT_ROUTES]],
	);
	const { rows: aliases } = await client.query<{
		word: string;
		people: string;
	}>(
		`select t.word, count(distinct e.emp_id) as people
		 from term t
		 join phrase p on p.text = t.word
		 join experience_phrase ep on ep.phrase_id = p.id and ep.route = any($1::text[])
		 join experience e on e.id = ep.experience_id
		 where t.word <> t.canonical
		 group by t.word
		 order by t.word`,
		[[...SHORT_ROUTES]],
	);
	const member = (row: { word: string; people: string }): Member => ({
		people: Number(row.people),
		word: row.word,
	});
	return { aliases: aliases.map(member), heads: heads.map(member) };
}

/**
 * 让判过的词生效，一个词一个词按收集顺序来：后一个词看到的是前一个生效之后的表。
 * 生效和删行在同一笔事务里：行没删掉，下一轮会把同一份判定再算一遍。人身上的词不动，
 * 所以这一步判错了，退回重判改回来就是改回来了，没有要恢复的东西。
 * 不成一条判断的行也删：那个词仍是没判过的，下一轮重新收集。
 */
export async function applyJudgments(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const rows = await judged(client, guideIdentity());
	if (rows.length === 0) return;

	const now = new Date();
	const table = await read(client);
	const changed = new Map<string, Decision>();
	const lines: string[] = [];
	const tally = { alone: 0, excluded: 0, invalid: 0, same: 0, under: 0 };
	for (const row of rows) {
		const verdict = conform(
			row.judgment,
			row.word,
			row.near.map((one) => one.word),
		);
		const decisions = verdict ? place(table, row, verdict, now) : [];
		if (!verdict || decisions.length === 0) {
			tally.invalid++;
			continue;
		}
		tally[verdict.kind]++;
		for (const [word, decision] of decisions) changed.set(word, decision);
		const own = table.get(row.word);
		if (own?.excluded) lines.push(`    ${row.word} 不是能力`);
		else if (own && own.canonical !== row.word)
			lines.push(`    ${row.word} → ${own.canonical}`);
		else if (own?.parent) lines.push(`    ${row.word} 属于 ${own.parent}`);
	}
	await client.query("begin");
	try {
		await write(client, [...changed]);
		await remove(
			client,
			rows.map((row) => row.id),
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}

	report(
		`  生效 ${rows.length} 个词的判定（${byJudge(rows)}）：同一件事 ${tally.same} 个，` +
			`属于 ${tally.under} 个，自成一项 ${tally.alone} 个，不是能力 ${tally.excluded} 个` +
			(tally.invalid ? `，不成判断 ${tally.invalid} 个` : ""),
	);
	for (const line of lines) report(line);
}

/**
 * 把人指定的范围退回成没判过：词表里的决定原样留着，照常用于检索和筛选，直到新的判定
 * 生效。一项连同它的其他写法一起退回；带细分时沿归属一层层往下。
 */
export async function sendBack(
	client: CorpusClient,
	report: Report,
	rejudge: Rejudge,
): Promise<void> {
	const { rowCount } =
		rejudge.scope === "term"
			? await client.query(
					`with recursive item(word) as (
					   select canonical from term where word = $1
					   union
					   select c.word from item i
					   join term c on c.parent = i.word and $2
					 )
					 update term t set reviewed_at = null
					 from item i where t.canonical = i.word`,
					[rejudge.word, rejudge.branch],
				)
			: await client.query(
					`update term set reviewed_at = null where excluded or $1`,
					[rejudge.scope === "all"],
				);
	const range =
		rejudge.scope === "all"
			? "整张词表"
			: rejudge.scope === "excluded"
				? "判成不是能力的词"
				: `「${rejudge.word}」${rejudge.branch ? "连同它的细分" : ""}`;
	report(`  ${range}退回重新判定，共 ${rowCount ?? 0} 个词`);
}

/**
 * 收集：每个没判过的词（词表里还没有它，或它被退回重判）配上词表里最接近的几个标准词，
 * 写一行进队列。判过的词不自动重判：同一个词、同样的参考词、同一份标准再问一遍
 * 得不到新的东西；要重判由人指定范围（`sendBack`）。别名也是要判的词：判开了就拆出来。
 *
 * 参考词只从标准词里取，判成不是能力的不作参考。队列里还没处理完的词不参与这一轮收集——
 * 一个词在队列里有两行，两份判定就会各说各的。
 *
 * 找参考词要词的向量：嵌入端点没配就不收集，队列里已有的词照常判、照常生效。
 */
export async function collectWords(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	if (!embedConfigured()) {
		report("  未配置嵌入端点，找不出相近的写法，这一轮不收集要判的词");
		return;
	}
	const table = await read(client);
	const all = await vocabulary(client);
	const identity = guideIdentity();
	const busy = await busyWords(client, identity);
	const words = [...all.heads, ...all.aliases];
	const decided = words.filter((one) => table.get(one.word)?.reviewedAt).length;
	report(
		`  词表 ${words.length} 个词，其中 ${decided} 个已经判过；` +
			`队列里还有 ${busy.size} 个词`,
	);

	const due = words.filter(
		(one) => !busy.has(one.word) && !table.get(one.word)?.reviewedAt,
	);
	report(`  ${due.length} 个词要判`);
	if (due.length === 0) return;

	const pool = all.heads.filter((one) => !table.get(one.word)?.excluded);
	const texts = [...new Set([...pool, ...due].map((one) => one.word))];
	const embedded = await embed(texts, report);
	const vectors = new Map(texts.map((text, index) => [text, embedded[index]]));
	const vectorOf = (one: Member) => vectors.get(one.word) as number[];
	const people = new Map(pool.map((one) => [one.word, one.people]));
	const near = nearest(
		pool.map((one) => one.word),
		pool.map(vectorOf),
	);
	const questions: Question[] = [];
	for (const one of due) {
		// 几万个词各扫一遍候选要几分钟：隔一会儿让出事件循环，别的请求才进得来
		if (questions.length % YIELD_EVERY === 0) await setImmediate();
		questions.push({
			...one,
			near: near(one.word, vectorOf(one)).map((word) => ({
				people: people.get(word) ?? 0,
				word,
			})),
		});
	}
	await collect(client, identity, questions);
}

/** 自带的模型判定方：把队列里没判的词一次问完，回答记在词上。 */
export async function judgeByModel(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const identity = guideIdentity();
	const pending = await openWords(client, identity);
	if (pending.length === 0) return;
	const model = reviewModel();
	report(`  判 ${pending.length} 个词`);

	const payloads = await askModel(pending, report);
	await recordJudgments(
		client,
		modelJudge(model),
		identity,
		pending.map((one, index) => [one.id, payloads[index]]),
	);
}
