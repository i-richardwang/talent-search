/**
 * 能力词词表：整理收集的归并组。相近的能力词圈成组送进队列，判定方判每个词和谁是
 * 同一件事、属于哪个更宽的词，生效时写进 `skill_term`。
 * 整理只写词表，不碰人身上的词：边上永远是简历里的原话，词表只决定筛选栏怎么把
 * 写法摆成一项项、每一项数到谁（`src/search/search.ts` 的 `FACT_COLUMNS.skills`）。
 * 归并和归属规则见 vocabulary-rules.ts；判定队列在 judgment.ts；模型和外部判定方共用 GUIDE。
 */

import "@tanstack/react-start/server-only";
import { z } from "zod";
import { complete, reviewModel } from "#/server/chat";
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

这是一个公司内部的人才库。招聘的人和业务负责人要找做过某件事的人：在筛选栏里点能力词，再读这个人简历里的原话确认。能力词是从每个人的简历里读出来的，人身上留的永远是他自己的写法，检索和证据用的都是原话。

词表不改人身上的词，只决定筛选栏怎么把这些写法摆成一项项、每一项数到哪些人。它记两件事：哪些写法是同一件事，在筛选栏里合成一项；一个词属于哪个更宽的词，点宽的词时把写了细的词的人一起带出来。这两件事由你来判。判过的词过一段时间会连同之前判成同一件事的写法再拿出来重判。

## 判错的代价

- 两件事判成同一件事：筛选栏里少了一项，点剩下那一项会混进不符合要求的人，更精确的那个选项也没了。
- 同一件事判成两件：筛选栏里多一项，点其中一项会漏掉写了另一种写法的人。
- 归属判错，点宽的词会混进不相干的人；归属漏判，点宽的词会漏掉做过其中一种的人。

合成一项会抹掉一个选项，挂归属不会。所以两个词一个比另一个宽的，用归属表达，不写成同一件事；拿不准是不是同一件事就不写。拿不准一个词属不属于某个更宽的词，写上：混进来的人点开能看到原话，漏掉的人没人知道。

## 任务

下面是一组写法相近的能力词，括号里是人数（写了它、它的其他写法或它下面任一个词的人）。组里可能有之前判成同一件事的写法，每个词照样按下面的标准重新判，不沿用之前的结论。对每个词判两件事：sameAs 和 parent。每个词一条 judgment：word 原样照抄；why 先用一句话说理由；再给 sameAs 和 parent，没有的写空字符串。每个词都要有一条。

## 同一件事（sameAs）

检验方法：招聘要求里写其中一个词，写了另一个词的人完全符合；反过来也完全符合。两个方向都成立才是同一件事，写这组里的那个词。同一件事的几个词可以互相指，最终用哪个写法由系统按人数定，你不用选。

通常是这几种：大小写、空格、标点不同；中英文或缩写（「推荐算法」「Recommendation」）；同义词（「人员管理」「团队管理」）；语序颠倒而意思不变（「销售策略运营」「销售运营策略」；「活动培训」和「培训活动」意思变了，不算）；多了不改变要找的人的字（「工作」「能力」，「指标体系」和「指标体系搭建」）。

只有一个方向成立的，不是同一件事：
- 一个比另一个细。写了「销售数据分析」的人符合「数据分析」，反过来不成立。细的属于宽的。
- 一个词太笼统，能指好几件事。「开发」可以是写代码，也可以是开发客户、开发课程，它和「代码开发」不是同一件事。

两个方向都不成立的，更不是：
- 兄弟：去掉限定语后一样。「销售数据分析」和「运营数据分析」找的是两批人，各自属于「数据分析」；「线下门店运营」和「电商店铺运营」对象不同，也是两批人。
- 同一件事里的不同角色或环节。「培训授课」是当讲师，「培训组织」是办培训。
- 邻居。「营销策略」和「运营策略」，「推荐系统」和「搜索推荐」。

## 属于（parent）

检验方法：招聘要求里写更宽的词，写了这个词的人都符合。也就是这个词是更宽的词的一种，只是限定了行业、对象、产品、渠道或技术。「销售数据分析」属于「数据分析」，「技术招聘」属于「招聘」，「品牌营销」属于「营销」。「团队培训」不属于「团队管理」，做过培训不等于管过团队；「数据分析报告」不属于「数据分析」，写报告不等于会分析。环节、产出物、工具、平台都不属于它服务的那项能力。

更宽的词可以不在这组里，也可以是简历里没人写过的，由你起名。这个名字会直接成为筛选栏里的一项，所以它得是招聘的人会点的能力词：招聘要求里「熟悉 ___」「有 ___ 经验」能填进去的业务通名，一般不超过八个字，不带动作、程度词，不带「能力」「相关」「工作」这类字。「销售数据分析」的更宽的词写「数据分析」，不写「数据相关」「分析能力」。别的组也在各自起名，用这项能力最通行的叫法，几组起出来的才会是同一个词。

写最近的一层：「电商销售数据分析」属于「销售数据分析」，不直接写「数据分析」。更宽的词永远是更宽的那个：「数据分析」不属于「销售数据分析」。`;

/**
 * 逐词给理由再下结论，不是直接列名单：让判定方一次列名单，它面对十来个相近的候选
 * 会整片说是或整片说否；逐词说完理由再判，每个词各判各的。理由只为约束判断，
 * 收窄时不读。schema 里不写长度和枚举：限制只写在收窄的地方（`conform`）。
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

/**
 * 读整张表。
 *
 * 表被手改坏的三种样子在这里抛错：别名的标准词自己又是别名、归属指向一个别名、
 * 归属成环。`merge` 不会写出这三种行；静默取其一只会让筛选栏少一批人而没人知道。
 */
export async function read(client: CorpusClient): Promise<Table> {
	const { rows } = await client.query<{
		word: string;
		canonical: string;
		parent: string | null;
		reviewed_at: Date;
		judge: string;
	}>("select word, canonical, parent, reviewed_at, judge from skill_term");
	const table: Table = new Map(
		rows.map((row) => [
			row.word,
			{
				canonical: row.canonical,
				judge: row.judge,
				parent: row.parent,
				reviewedAt: row.reviewed_at,
			},
		]),
	);
	validate(table);
	return table;
}

/**
 * 把这些决定写回表。
 *
 * 收的是**决定本身**，不是一串词名再回表里查：查得到查不到就得有个说法，而
 * 「查不到时写个空标准词」是一行悄悄坏掉的词表。`merge` 手里本来就有决定。
 * 归属指回本表，所以判定方起的名字也在这一批里作为一行写进去；外键在语句末尾才查，
 * 一条语句里父子同时落下没有先后。
 */
async function write(client: CorpusClient, decisions: [string, Decision][]) {
	if (decisions.length === 0) return;
	await client.query(
		`insert into skill_term (word, canonical, parent, reviewed_at, judge)
		 select * from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::text[])
		 on conflict (word) do update
		 set canonical = excluded.canonical,
		     parent = excluded.parent,
		     reviewed_at = excluded.reviewed_at,
		     judge = excluded.judge`,
		[
			decisions.map(([word]) => word),
			decisions.map(([, decision]) => decision.canonical),
			decisions.map(([, decision]) => decision.parent),
			decisions.map(([, decision]) => decision.reviewedAt),
			decisions.map(([, decision]) => decision.judge),
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
 * 这一轮要整理的词表：标准词和各自的人数，按词排序；以及每个标准词名下其他写法各自的人数。
 *
 * **词表里只有一种词。** 人写的词和判定方起的名字在这里没有分别：都是标准词，人数都按
 * 「写了它、它的其他写法或它下面任一个词的人」数（筛选栏同一口径，`src/server/skills.ts`），
 * 都一样圈组、收集、到期再判。所以词表是**表里的标准词，加上语料里还没进表的词**——后者是
 * 还没判过的标准词。只从语料取词的话，判定方起的名字永远不会被再问一次：「销售数据分析」
 * 挂不到「数据分析」下面，两组各自起的「数据分析」「数据分析能力」也永远并不到一起。
 *
 * 其他写法不做中心词、不单独圈组，只跟着它的标准词进组（`collectGroups`）：它和标准词是不是
 * 同一件事正是每次重判要问的，而它不在组里时拆不开，在别的组里单独出现又会被判进另一片，
 * 把它从标准词那里悄悄拽走。
 *
 * 下面一个人都没有的词不在这一轮里：没人会点它，也就没什么可整理的。
 */
async function vocabulary(client: CorpusClient) {
	const { rows } = await client.query<{ word: string; people: string }>(
		`with recursive term(word) as (
		   select word from skill_term where word = canonical
		   union
		   select p.text from phrase p
		   where exists (select 1 from experience_phrase ep
		                 where ep.phrase_id = p.id and ep.route = 'skill')
		     and not exists (select 1 from skill_term t where t.word = p.text)
		 ), under(term, word) as (
		   select word, word from term
		   union
		   select canonical, word from skill_term where word <> canonical
		   union
		   select u.term, a.word from under u
		   join skill_term c on c.parent = u.word
		   join skill_term a on a.canonical = c.word
		 )
		 select u.term as word, count(distinct e.emp_id) as people
		 from under u
		 join term t on t.word = u.term
		 join phrase p on p.text = u.word
		 join experience_phrase ep on ep.phrase_id = p.id and ep.route = 'skill'
		 join experience e on e.id = ep.experience_id
		 group by u.term
		 order by u.term`,
	);
	const { rows: spellings } = await client.query<{
		word: string;
		canonical: string;
		people: string;
	}>(
		`select t.word, t.canonical, count(distinct e.emp_id) as people
		 from skill_term t
		 join phrase p on p.text = t.word
		 join experience_phrase ep on ep.phrase_id = p.id and ep.route = 'skill'
		 join experience e on e.id = ep.experience_id
		 where t.word <> t.canonical
		 group by t.word, t.canonical
		 order by t.word`,
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
 * 让判过的归并组生效：收窄判定结果、更新词表、组从队列里删掉。
 *
 * 两样在同一笔事务里：组没删掉，下一轮会把同一份判定再算一遍。人身上的词不动，
 * 所以这一步判错了，下一次重判改回来就是改回来了，没有要恢复的东西。
 */
export async function applyGroups(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const rows = await judged(client, "group");
	if (rows.length === 0) return;

	const now = new Date();
	const table = await read(client);
	const changed = new Map<string, Decision>();
	for (const row of rows) {
		const verdicts = conform(
			row.judgment,
			row.words.map((one) => one.word),
		);
		for (const [word, decision] of merge(
			table,
			row.words,
			verdicts,
			now,
			row.judge,
		))
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
 * 收集：到期的词圈成组，每个标准词带上它名下的其他写法，每组落一行。
 *
 * 队列里挂着的组涉及的词整个不参与这一轮圈组——一个词同时出现在两组里，两份
 * 判定就会各说各的，而生效时挑哪一份都得有个说法。其他写法跟着标准词进出，
 * 标准词不在别的组里，它的写法也就不在。
 *
 * 带上写法之后一组可以超过圈组的上限（`vocabulary-rules.ts`）：上限管的是有多少件要分辨的事，
 * 已经判成同一件事的写法摆在标准词旁边，是让判定方重新确认这一片，不是多出来的候选。
 */
export async function collectGroups(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const table = await read(client);
	const all = await vocabulary(client);
	const busy = await busyWords(client, "group");
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
	const circles = words.length
		? groups(words, counts, await embed(words, report), due)
		: [];
	report(`  圈成 ${circles.length} 组`);
	if (circles.length === 0) return;

	const people = new Map(
		words.map((word, index) => [word, counts[index] ?? 0]),
	);
	await collect(
		client,
		"group",
		circles.map((circle) =>
			circle.flatMap((word) => [
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
	const pending = (await openGroups(client)).filter(
		(one) => one.kind === "group",
	);
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
		pending.map((one, index) => [one.id, payloads[index]]),
	);
}
