/**
 * 查询记录的读写：一次查询是**库里的一行**，不是地址栏里的一串条件。
 *
 * 这条设计换来的是查询有身份——一行有 id、有父记录、有原话，于是「重新理解」
 * 「撤销」「最近搜索」「模型判错了多少次」这些事才有东西可依附。写进 URL 的
 * 条件串做不到其中任何一件：它一次性，改一下就没了。
 *
 * 这里只有普通函数，一个 `createServerFn` 都没有。暴露给页面的那一层住在
 * `functions.ts`：整个应用只有那一个 RPC 边界。
 */

import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import type { SearchTurn } from "#/db/schema";
import { searchTurn } from "#/db/schema";
import { type Intent, resolveIntent } from "#/search/intent";
import {
	type Chip,
	parseChips,
	type QueryChange,
	toQuery,
} from "#/search/parse";
import { companyTags, probeTerms } from "#/search/search";
import { understand } from "./llm";

/**
 * 记录 id 会出现在 URL 里，所以要短、要能双击选中、要不带 `-` 和 `_` 之外的
 * 记号。11 个 base64url 字符承载 64 bit 随机量，对一个内部工具的记录量来说，碰撞概率
 * 远低于「主键冲突时 INSERT 报错」这条兜底本身的成本。
 */
function newId() {
	return randomBytes(8).toString("base64url");
}

/** 界面要用的一条记录。数据库行原样传，只多一个「还没理解」的判定。 */
export type Turn = {
	id: string;
	rootTurnId: string;
	rawText: string | null;
	/** null 表示还没理解——界面据此渲染「正在理解…」并触发 `interpretTurn` */
	chips: Chip[] | null;
	degraded: boolean;
};

function toTurn(row: SearchTurn): Turn {
	return {
		id: row.id,
		rootTurnId: row.rootTurnId,
		rawText: row.rawText,
		chips: row.chips,
		degraded: row.degraded,
	};
}

/**
 * 落一条记录。**只 INSERT，不改已有的行**——记录是不可变的，「改查询」的
 * 意思是派生一条新的挂在 `parentTurnId` 上。
 *
 * 这一点是整套设计的支点：不可变才能让 `/s/:id` 永远指向同一个问题（分享、
 * 刷新、后退都成立——复现的是条件，名单跟着语料和时间走），也才能让
 * 「上一步是什么样」这件事自然留在库里，而不需要另外记一份操作日志。
 */
async function insertTurn(row: {
	parent: SearchTurn | null;
	rawText: string | null;
	chips: Chip[] | null;
	filters?: Intent["filters"];
	degraded?: boolean;
	baseTurnId?: string | null;
}): Promise<Turn> {
	const id = newId();
	const [inserted] = await db
		.insert(searchTurn)
		.values({
			id,
			// 链头自己就是 root；派生出来的记录跟着父亲走，于是「最近搜索」
			// 里一次找人任务只占一行，停在它最后的样子上。
			rootTurnId: row.parent ? row.parent.rootTurnId : id,
			parentTurnId: row.parent?.id ?? null,
			baseTurnId: row.baseTurnId ?? null,
			rawText: row.rawText,
			chips: row.chips,
			filters: row.filters ?? {},
			degraded: row.degraded ?? false,
		})
		.returning();
	if (!inserted) throw new Error("写入查询记录失败");
	return toTurn(inserted);
}

async function getRow(id: string): Promise<SearchTurn | null> {
	const [row] = await db.select().from(searchTurn).where(eq(searchTurn.id, id));
	return row ?? null;
}

/**
 * 开一次新查询，或从已有的一条派生一次修改。
 *
 * **整句只落原话，不在这里等模型。** 一次 INSERT 是毫秒级的，于是从零态
 * 点下「搜索」到工作台出现之间没有等待——理解那一跳挪到工作台里就地完成
 * （`interpretTurn`），转圈发生在结果将要出现的地方，而不是发生在按钮上。
 * 这是把模型调用从「挡在用户和界面之间」挪成「界面已经在了，内容在填」。
 *
 * 已经成型的 chips 直接落地：那是查询理解的产物（点词汇表、改一枚 chip 的
 * 强度），送回去让模型再猜一遍只会变坏，还要为一个从语料里取出来的词
 * 白等十几秒。
 */
export async function createTurn(
	input: QueryChange,
	parentTurnId?: string,
): Promise<{ turnId: string }> {
	const parent = parentTurnId ? await getRow(parentTurnId) : null;
	// 说了从哪派生却找不到那一条：不能当成「那就开条新的吧」。那样人会得到
	// 一条丢了全部已有条件的查询，而屏幕上没有任何东西说明条件去哪了。
	if (parentTurnId && !parent) throw new Error("要修改的查询记录不存在");
	// 派生只能建立在一份已经成型的条件上。否则子记录先去理解时看不到父 chips，
	// 会安静地从空条件开始；这不是并发问题，而是一条不完整的记录。
	if (parent && parent.chips === null)
		throw new Error("查询仍在理解中，暂时不能派生新记录");

	let turn: Turn;
	if (input.kind === "reinterpret") {
		if (!parent?.rawText) throw new Error("重新理解需要一条由整句产生的父记录");
		turn = await insertTurn({
			parent,
			baseTurnId: parent.baseTurnId,
			rawText: parent.rawText,
			chips: null,
		});
	} else if (input.kind === "sentence") {
		turn = await insertTurn({
			parent,
			baseTurnId: parent?.id ?? null,
			rawText: input.text,
			chips: null,
		});
	} else {
		turn = await insertTurn({ parent, rawText: null, chips: input.chips });
	}
	return { turnId: turn.id };
}

/**
 * 相近说法（near）落库前的语料体检：模型译的词必须在库里真实命中过才配上屏。
 *
 * 语料就是词典——和 relaxTerm、companyTags 同一条原则。搜不到人的翻译留下来，
 * 界面上就多一个看着在参与、实际什么都没捞到的说法；在这里删掉，检索层也就
 * 不必为 near 准备松弛（体检过的词要么还在语料里，要么语料变了、它安静地
 * 不命中，两种都不需要二次降级）。只体检 near：full 说法是用户自己写的，
 * 搜不到时走松弛并在 chip 上明说，那是另一条已有的路。
 */
async function vetNearMembers(chips: Chip[]): Promise<Chip[]> {
	const nearTexts = [...new Set(chips.flatMap((c) => c.near ?? []))];
	if (nearTexts.length === 0) return chips;
	const found = await probeTerms(nearTexts);
	return chips.map((c) => {
		if (!c.near) return c;
		const near = c.near.filter((n) => found.has(n));
		const { near: _drop, ...rest } = c;
		return near.length > 0 ? { ...rest, near } : rest;
	});
}

/**
 * 把一条只有原话的记录补上理解结果。
 *
 * 这是 `search_turn` 唯一一处 UPDATE，而且只补 `chips is null` 的那一行：
 * 谓词写在 WHERE 里，所以两个标签页同时打开同一条待理解的记录时，晚到的
 * 那次更新自己就落空了，不会把先到的结果覆盖掉。理解一旦落下就不再变，
 * 记录重新变回不可变的。
 *
 * 追加条件（在工作台里再敲一句话）在这里合并：新词接在 `baseTurnId` 指向的
 * chips 后面，去重交给 `parseChips`。重新理解沿用同一个 base，只替换这句话
 * 产生的条件；历史父链不参与语义合并。
 */
export async function resolveTurn(
	turnId: string,
): Promise<{ chips: Chip[]; filters: Intent["filters"] }> {
	const row = await getRow(turnId);
	if (!row) throw new Error("查询记录不存在");
	// 已经理解过了：直接回放，不再打模型。并发的第二次调用走这一支。
	if (row.chips) return { chips: row.chips, filters: row.filters };

	const text = row.rawText ?? "";
	const tags = await companyTags();
	const intent = resolveIntent(text, await understand(text, tags), tags);

	const base = row.baseTurnId ? await getRow(row.baseTurnId) : null;
	const merged = base?.chips
		? parseChips(
				[toQuery(base.chips), toQuery(intent.chips)].filter(Boolean).join(","),
			)
		: intent.chips;
	const chips = await vetNearMembers(merged);

	await db
		.update(searchTurn)
		.set({ chips, filters: intent.filters, degraded: intent.degraded })
		.where(and(eq(searchTurn.id, row.id), isNull(searchTurn.chips)));

	// 落空的那次（另一个标签页先写了）要读回真正生效的那一份，
	// 否则两边会各自按自己算出来的条件去检索同一个 id。
	const settled = await getRow(row.id);
	return {
		chips: settled?.chips ?? chips,
		filters: settled?.filters ?? intent.filters,
	};
}

/** 读一条记录。工作台的 loader 用它，读不到就是 404。 */
export async function loadTurn(id: string): Promise<Turn | null> {
	const row = await getRow(id);
	return row ? toTurn(row) : null;
}

/** 「最近搜索」给几条。零态一屏之内扫得完，再多就成了要读的正文。 */
const RECENT_MAX = 8;

export type RecentSearch = {
	turnId: string;
	/** 这条链上最后一次查询的样子 */
	chips: Chip[];
	/**
	 * 这条链**最初**那句话——后面几步是「加了个词」「改了个强度」，
	 * 而这次搜索是从哪句话开始的，只有链头知道。点词汇表开始的链没有原话，
	 * 列表就直接显示条件。
	 */
	rawText: string | null;
	createdAt: string;
};

/**
 * 最近搜索：每条链一行，停在它**最后**的样子上。
 *
 * 按 `root_turn_id` 去重而不是把每一条记录都列出来——一次找人任务会派生出
 * 五六条记录（加了个词、改了个强度），全列出来的话列表里全是同一次搜索的
 * 中间态。人要回到的是「昨天那次找运营的活儿」，不是它的第三步。
 *
 * 还没理解完的记录不进来（`chips is not null`）：它还没有可显示的条件，
 * 而这个列表的每一行都要能一眼看出「那次我在找什么」。
 */
export async function listRecent(): Promise<RecentSearch[]> {
	const rows = await db.execute<{
		id: string;
		chips: Chip[];
		created_at: Date;
		root_raw_text: string | null;
	}>(sql`
			select latest.id, latest.chips, latest.created_at,
				root.raw_text as root_raw_text
			from (
				select distinct on (root_turn_id) id, root_turn_id, chips, created_at
				from search_turn where chips is not null
				order by root_turn_id, created_at desc
			) latest
			join search_turn root on root.id = latest.root_turn_id
			order by latest.created_at desc
			limit ${RECENT_MAX}`);
	return rows.rows.map((r) => ({
		turnId: r.id,
		chips: r.chips,
		rawText: r.root_raw_text,
		// 统一成 ISO 串再出门：pg 把 timestamptz 解析成 Date，而这一条要
		// 穿过 SSR 序列化到浏览器，Date 在那一步会变成一个不受控的字符串。
		createdAt: new Date(r.created_at).toISOString(),
	}));
}
