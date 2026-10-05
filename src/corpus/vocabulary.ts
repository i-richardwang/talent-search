/**
 * 短说法的词表：整理收集的归并组。相近的短说法（`SHORT_ROUTES`）圈成组送进队列，
 * 判定方判每个词和谁是同一件事、属于哪个更宽的词，生效时写进 `term`。
 * 整理只写词表，不碰人身上的词：边上永远是简历里的原话。检索按词表把命中往细的词
 * 带、对更宽的词挡住（`src/search/phrases.ts` 的 `throughVocabulary`），筛选栏按它
 * 把写法摆成一项项（`src/search/search.ts` 的 `FACT_COLUMNS.skills`）。
 * 归并和归属规则见 vocabulary-rules.ts；判定队列在 judgment.ts；模型和外部判定方共用 GUIDE。
 */

import "@tanstack/react-start/server-only";
import { z } from "zod";
import { SHORT_ROUTES } from "#/db/schema";
import { complete, reviewModel, standardOf } from "#/server/chat";
import { embed } from "./embed";
import {
	busyWords,
	byJudge,
	collect,
	judged,
	type Member,
	modelJudge,
	openGroups,
	promptOf,
	REVIEW_INTERVAL_DAYS,
	recordJudgments,
	remove,
} from "./judgment";
import type { Report } from "./report";
import type { CorpusClient } from "./session";
import {
	conform,
	type Decision,
	groups,
	merge,
	type Table,
	validate,
} from "./vocabulary-rules";

/**
 * 判定的标准。发给自带模型的是它，通过接口交给外部 agent 的也是它
 * （`src/server/review.ts` 的 `guides.group`）——**标准只有一份**，改了这段字两边
 * 一起变。
 */
export const GUIDE = `## 背景

这是一个公司内部的人才库。招聘的人和业务负责人要找做过某件事的人：输入一个词搜索，或在筛选栏里点一项，再读这个人简历里的原话确认。每个人的简历被读成几个字的短说法：能力词、做过的事、入职前的岗位名。人身上留的永远是他自己的写法，证据用的都是原话。

词表不改人身上的词，它记两件事：哪些写法是同一件事；一个词属于哪个更宽的词。搜索和筛选都按它走：搜一个词或点一项，写了它的其他写法、写了属于它的细词的人一起出来；搜细的词时，只写了更宽的词的人不算，因为没法确认他做过细的那件。这两件事由你来判。判过的词过一段时间会连同之前判成同一件事的写法再拿出来重判。

## 判错的代价

- 两件事判成同一件事：搜其中一个会混进不符合要求的人，筛选栏里更精确的那个选项也没了。
- 同一件事判成两件：搜其中一个会漏掉写了另一种写法的人，筛选栏里多一项。
- 归属挂错：搜宽的词时，写了这个词的人整批算作符合，和真正做过的人排在一起；搜细的词时，只写了宽词的人被挡掉。
- 归属漏挂：搜索仍会直接判断这个词像不像要找的，像的照样找得到；只是筛选栏里点宽的那一项时不含它。

合成一项会抹掉一个选项，挂归属不会。所以两个词一个比另一个宽的，用归属表达，不写成同一件事。拿不准是不是同一件事、拿不准属不属于某个更宽的词，都不写：漏写了搜索还能补上，写错了没有。

## 任务

下面是一组写法相近的短说法，括号里是人数（写了它、它的其他写法或它下面任一个词的人）。组里可能有之前判成同一件事的写法，每个词照样按下面的标准重新判，不沿用之前的结论。对每个词判两件事：sameAs 和 parent。每个词一条 judgment：word 原样照抄；why 先用一句话说理由；再给 sameAs 和 parent，没有的写空字符串。每个词都要有一条。

## 同一件事（sameAs）

检验方法：招聘要求里写其中一个词，写了另一个词的人完全符合；反过来也完全符合。两个方向都成立才是同一件事，写这组里的那个词。同一件事的几个词可以互相指，最终用哪个写法由系统按人数定，你不用选。

通常是这几种：大小写、空格、标点不同；中英文或缩写（「推荐算法」「Recommendation」）；同义词（「人员管理」「团队管理」）；语序颠倒而意思不变（「销售策略运营」「销售运营策略」；「活动培训」和「培训活动」意思变了，不算）；多了不改变要找的人的字（「工作」「能力」，「指标体系」和「指标体系搭建」）。

只有一个方向成立的，不是同一件事：
- 一个比另一个细。写了「销售数据分析」的人符合「数据分析」，反过来不成立。细的属于宽的。
- 一个词太笼统，能指好几件事。「开发」可以是写代码，也可以是开发客户、开发课程，它和「代码开发」不是同一件事。
- 岗位名多了级别或带人的字：「高级」「资深」「主管」「总监」「助理」。招「X 主管」要的是带过人的，做过 X 的人不一定符合。带级别的岗位名属于不带级别的那个。

两个方向都不成立的，更不是：
- 兄弟：去掉限定语后一样。「销售数据分析」和「运营数据分析」找的是两批人，各自属于「数据分析」；「线下门店运营」和「电商店铺运营」对象不同，也是两批人。
- 同一件事里的不同角色或环节。「培训授课」是当讲师，「培训组织」是办培训。
- 邻居。「营销策略」和「运营策略」，「推荐系统」和「搜索推荐」。

## 属于（parent）

检验方法：招聘要求里写更宽的词，写了这个词的人都符合。也就是这个词是更宽的词的一种，只是限定了行业、对象、产品、渠道或技术。「销售数据分析」属于「数据分析」，「技术招聘」属于「招聘」，「品牌营销」属于「营销」。「团队培训」不属于「团队管理」，做过培训不等于管过团队；「数据分析报告」不属于「数据分析」，写报告不等于会分析。

分清「是一种」和「用来做」。一个产品、一门技术本身就是更宽的词的一种，就属于它：「PostgreSQL」是一种数据库，属于「数据库」；「Go」是一门编程语言。只是做那件事时用到的环节、产出物、工具、平台，不属于它服务的那项能力：用过 Jira 不等于做过项目管理，会做 PPT 不等于做过方案策划。

按这个人做的是哪一行的活来判，不按两个词共有几个字。岗位名里，称呼（经理、专员、工程师）前面的那个词说的是哪一行：「商家运营经理」做的是运营，和「商家经理」「产品经理」共有的字不说明他做过那一行。

更宽的词可以不在这组里，也可以是简历里没人写过的，由你起名。写法相近的词才分在一组，所以最常见的更宽的词往往不在组里：按招聘时的行当去想，岗位名属于它所在的那一行。这个名字会成为筛选栏里的一项，也是招聘的人搜索时会输入的词，所以它得是：招聘要求里「熟悉 ___」「有 ___ 经验」能填进去的业务通名，一般不超过八个字，不带动作、程度词，不带「能力」「相关」「工作」这类字。「销售数据分析」的更宽的词写「数据分析」，不写「数据相关」「分析能力」。别的组也在各自起名，用这项能力最通行的叫法，几组起出来的才会是同一个词。

写最近的一层：「电商销售数据分析」属于「销售数据分析」，不直接写「数据分析」。更宽的词永远是更宽的那个：「数据分析」不属于「销售数据分析」。`;

/**
 * 逐词给理由再下结论，不是直接列名单：让判定方一次列名单，它面对十来个相近的候选
 * 会整片说是或整片说否；逐词说完理由再判，每个词各判各的。理由只为约束判断，
 * 校验时不读。schema 里不写长度和枚举：限制只写在校验的地方（`conform`）。
 */
const SCHEMA = z.object({
	judgments: z.array(
		z.object({
			word: z.string(),
			why: z.string(),
			sameAs: z.string(),
			parent: z.string(),
		}),
	),
});

/** 归并与归属这件事此刻的判定标准。队列与外部判定接口都按它隔离版本。 */
export function groupIdentity(): string {
	return standardOf(GUIDE, SCHEMA);
}

/**
 * 表被手改坏的三种样子在这里抛错：别名的标准词自己又是别名、归属指向一个别名、
 * 归属成环。`merge` 不会写出这三种行；静默取其一只会让筛选栏少一批人而没人知道。
 */
export async function read(client: CorpusClient): Promise<Table> {
	const { rows } = await client.query<{
		word: string;
		canonical: string;
		parent: string | null;
		reviewed_at: Date;
	}>("select word, canonical, parent, reviewed_at from term");
	const table: Table = new Map(
		rows.map((row) => [
			row.word,
			{
				canonical: row.canonical,
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
		`insert into term (word, canonical, parent, reviewed_at)
		 select * from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[])
		 on conflict (word) do update
		 set canonical = excluded.canonical,
		     parent = excluded.parent,
		     reviewed_at = excluded.reviewed_at`,
		[
			decisions.map(([word]) => word),
			decisions.map(([, decision]) => decision.canonical),
			decisions.map(([, decision]) => decision.parent),
			decisions.map(([, decision]) => decision.reviewedAt),
		],
	);
}

/**
 * 让自带的模型判一批组，按组的顺序返回它的原话；答不出合法 JSON 的那组是 undefined
 * （`complete` 已经说过是哪一组）。整理的判定一步和整理质量验收（`scripts/eval-review.ts`）
 * 共用它：验收量的正是这一步，提示词、模型、温度都和整理时一样。
 */
export async function askModel(
	groups: Member[][],
	report: Report,
): Promise<(unknown | undefined)[]> {
	const inputs = groups.map(promptOf);
	const payloads = await complete(
		reviewModel(),
		GUIDE,
		SCHEMA,
		inputs,
		"整理",
		report,
	);
	return inputs.map((input) => payloads.get(input));
}

/**
 * 收集有实际人群的标准词及其人数；标准词包括判定方命名的父词和尚未入词表的语料词。
 * 人数包含其别名与后代。别名保留原写法的人数，跟标准词一起进组接受重判。
 */
async function vocabulary(client: CorpusClient) {
	const { rows } = await client.query<{ word: string; people: string }>(
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
	const { rows: spellings } = await client.query<{
		word: string;
		canonical: string;
		people: string;
	}>(
		`select t.word, t.canonical, count(distinct e.emp_id) as people
		 from term t
		 join phrase p on p.text = t.word
		 join experience_phrase ep on ep.phrase_id = p.id and ep.route = any($1::text[])
		 join experience e on e.id = ep.experience_id
		 where t.word <> t.canonical
		 group by t.word, t.canonical
		 order by t.word`,
		[[...SHORT_ROUTES]],
	);
	const aliases = new Map<string, Member[]>();
	for (const row of spellings)
		aliases.set(row.canonical, [
			...(aliases.get(row.canonical) ?? []),
			{ people: Number(row.people), word: row.word },
		]);
	return {
		words: rows.map((row) => row.word),
		counts: rows.map((row) => Number(row.people)),
		aliases,
	};
}

/**
 * 让判过的归并组生效。生效和删组在同一笔事务里：组没删掉，下一轮会把同一份判定
 * 再算一遍。人身上的词不动，所以这一步判错了，下一次重判改回来就是改回来了，
 * 没有要恢复的东西。
 */
export async function applyGroups(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const rows = await judged(client, "group", groupIdentity());
	if (rows.length === 0) return;

	const now = new Date();
	const table = await read(client);
	const changed = new Map<string, Decision>();
	for (const row of rows) {
		const verdicts = conform(
			row.judgment,
			row.words.map((one) => one.word),
		);
		for (const [word, decision] of merge(table, row.words, verdicts, now))
			changed.set(word, decision);
	}
	const merged = [...changed].filter(
		([word, decision]) => decision.canonical !== word,
	);
	const placed = [...changed].filter(
		([, decision]) => decision.parent !== null,
	);
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
		`  生效 ${rows.length} 组归并（${byJudge(rows)}），` +
			`认成同一写法 ${merged.length} 个，认出归属 ${placed.length} 个`,
	);
	for (const [alias, decision] of merged)
		report(`    ${alias} → ${decision.canonical}`);
	for (const [word, decision] of placed)
		report(`    ${word} 属于 ${decision.parent}`);
}

/**
 * 收集：到期的词分成组，每个标准词带上它名下的其他写法，每组写一行。
 *
 * 队列里还没处理完的组涉及的词整个不参与这一轮分组——一个词同时出现在两组里，两份
 * 判定就会各说各的，而生效时挑哪一份都得有个说法。其他写法跟着标准词进出，
 * 标准词不在别的组里，它的写法也就不在。
 *
 * 带上写法之后一组可以超过分组的上限（`vocabulary-rules.ts`）：上限管的是有多少件要分辨的事，
 * 已经判成同一件事的写法摆在标准词旁边，是让判定方重新确认这一片，不是多出来的候选。
 */
export async function collectGroups(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const table = await read(client);
	const all = await vocabulary(client);
	const identity = groupIdentity();
	const busy = await busyWords(client, "group", identity);
	const decided = all.words.filter((word) => table.has(word)).length;
	report(
		`  词表 ${all.words.length} 个词，其中 ${decided} 个已有决定；` +
			`队列里还有 ${busy.size} 个词`,
	);
	if (all.words.length === 0) return;

	const free = [...all.words.keys()].filter(
		(index) => !busy.has(all.words[index] as string),
	);
	const words = free.map((index) => all.words[index] as string);
	const counts = free.map((index) => all.counts[index] as number);
	const overdue = Date.now() - REVIEW_INTERVAL_DAYS * 86_400_000;
	const due = new Set(
		words.filter((word) => {
			const decision = table.get(word);
			return !decision || decision.reviewedAt.getTime() <= overdue;
		}),
	);
	const clusters = words.length
		? groups(words, counts, await embed(words, report), due)
		: [];
	report(`  分成 ${clusters.length} 组`);
	if (clusters.length === 0) return;

	const people = new Map(
		words.map((word, index) => [word, counts[index] ?? 0]),
	);
	await collect(
		client,
		"group",
		identity,
		clusters.map((cluster) =>
			cluster.flatMap((word) => [
				{ people: people.get(word) ?? 0, word },
				...(all.aliases.get(word) ?? []),
			]),
		),
	);
}

/** 自带的模型判定方：把队列里没判的归并组一次问完，回答记在组上。 */
export async function judgeGroupsByModel(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const identity = groupIdentity();
	const pending = await openGroups(client, "group", identity);
	if (pending.length === 0) return;
	const model = reviewModel();
	report(`  判 ${pending.length} 组归并`);

	const payloads = await askModel(
		pending.map((one) => one.words),
		report,
	);
	await recordJudgments(
		client,
		modelJudge(model),
		identity,
		pending.map((one, index) => [one.id, payloads[index]]),
	);
}
