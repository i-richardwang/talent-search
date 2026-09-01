/**
 * 检索的取数层：把一句话变成「哪些经历段命中了哪个概念词」这一份事实，交给
 * `rank.ts` 去打分、排序、算分面。
 *
 * 这个文件里没有任何权重、没有 AND 判定、没有分面口径——它只回答「命中了什么」。
 * 「怎么找到人」和「找到之后怎么排」分别演进；取数方式变化时，排名逻辑不动。
 */

import "@tanstack/react-start/server-only";
import { inArray, type SQL, sql } from "drizzle-orm";
import { db } from "#/db";
import { employee, experience } from "#/db/schema";
import { seqLabel } from "#/lib/format";
import { activeChips, type Chip, parseQuery } from "./parse";
import { type Fact, pageHits, rank } from "./rank";
import {
	emptyFacets,
	type Hit,
	type MemberPlan,
	type Overview,
	type SearchFilters,
	type SearchOutcome,
	type SearchResult,
	type TermPlan,
} from "./result";
import {
	FACT_MAX,
	FORM_WEIGHTS,
	HITS_PER_TERM,
	RESULT_MAX,
	RESULT_PAGE,
	ROUTE_ORDER,
	ROUTE_WEIGHTS,
	type Route,
} from "./weights";

/**
 * 每一路看哪些原文字段。这是「可检索字段」的唯一清单：命中判定（matchExpr）
 * 与路径判定（routeExpr）都从它派生，加一个字段只改这里。
 *
 * `ROUTE_ORDER` 由权重直接推导：一段同时命中多路时，权重最高的一路胜出。
 *
 * 四路同时判、取最硬的一路——序列是 HR 认定的归属，部门只说明他在那个组织里。
 * 当前匹配全部落在可追溯的经历原文字段上，不维护另一套派生标签。
 */
const ROUTE_FIELD: Record<Route, (p: SQL) => SQL> = {
	seq: (p) =>
		sql`e.seq_l1 ilike ${p} or e.seq_l2 ilike ${p} or e.seq_l3 ilike ${p}`,
	title: (p) => sql`e.title ilike ${p}`,
	org: (p) => sql`e.org ilike ${p} or e.org_path ilike ${p}`,
	description: (p) => sql`e.description <> '' and e.description ilike ${p}`,
};

const ROUTE_FIELDS = ROUTE_ORDER.map(
	(route) => [route, ROUTE_FIELD[route]] as const,
);

/**
 * 用户输入里的 `%` `_` `\` 是 ILIKE 的元字符，必须先转义成字面量。
 *
 * 不转义的话「%%」两个字符就让每一行恒真并扫描全表；
 * 而「客户_经理」里的下划线会悄悄变成「任意一个字」。反斜杠是 Postgres 的
 * 默认转义符，不必额外写 escape。
 */
function escapeLike(term: string) {
	return term.replace(/[\\%_]/g, "\\$&");
}

/** 检索一律走子串（见 docs/PLAN.md），模式串只在这里拼一次 */
function like(term: string) {
	return sql`${`%${escapeLike(term)}%`}`;
}

/** 命中哪一路。都不中就是 null，调用方据此把这一段丢掉。 */
function routeExpr(p: SQL) {
	const whens = ROUTE_FIELDS.map(
		([route, on]) => sql`when (${on(p)}) then ${route}::text`,
	);
	return sql`case ${sql.join(whens, sql` `)} end`;
}

/** 有没有命中任何一路。先用它把候选段筛出来，再判路径。 */
function matchExpr(p: SQL) {
	const any = ROUTE_FIELDS.map(([, on]) => sql`(${on(p)})`);
	return sql`(${sql.join(any, sql` or `)})`;
}

/**
 * 服务端边界的收窄：把任意 unknown 收成一份可信的 SearchFilters。
 *
 * 界面那侧的 `validateView` 管的是 URL（非法值不能渲染成「-999 个月」这种
 * 选中态），这里管的是**进程边界**——服务端函数是一个可以被直接调用的端点，
 * 不经过任何页面。少了这一道，`minMonths: "abc"` 会一路走到比较里变成 NaN，
 * 而 NaN 的比较恒假，于是一个坏参数会安静地把所有人筛没。
 */
export function sanitizeFilters(v: unknown): SearchFilters {
	const f = (v ?? {}) as Record<string, unknown>;
	const str = (x: unknown) =>
		typeof x === "string" && x.trim() ? x.trim() : undefined;
	const months = Number(f.minMonths);
	return {
		seqL1: str(f.seqL1),
		seqL2: str(f.seqL2),
		companyTag: str(f.companyTag),
		minMonths: Number.isInteger(months) && months > 0 ? months : undefined,
		kind: f.kind === "internal" || f.kind === "external" ? f.kind : undefined,
		strong: f.strong === true ? true : undefined,
	};
}

/**
 * 服务端边界的收窄：把任意 unknown 收成一个能直接当页大小用的整数。
 *
 * 和 sanitizeFilters 同一个理由，但这一个更硬：它决定这次要序列化多大一份载荷。
 * 非法值一律退回一页，不是退回 0——「看不懂你要多少」和「你不要」是两件事，
 * 后者会让页面在一个坏链接上变成空表，而空表在这个界面里意味着「没有这样的人」。
 */
export function sanitizeLimit(v: unknown): number {
	const n = Number(v);
	if (!Number.isInteger(n) || n <= 0) return RESULT_PAGE;
	return Math.min(n, RESULT_MAX);
}

/**
 * 整词搜不到时，退到它内部最长的、在语料里真实出现过的子串。
 *
 * 「线下渠道运营」没有任何一段经历原文包含它，但「渠道运营」有。中文没有空格，
 * 用户输入的是短语而库里存的是另一种说法；这里不维护词表，直接拿语料当词典：
 * 从最长的子串开始试，第一个有命中的就是这个词的有效检索形态。
 * pg_trgm 的相似度在中文上不可用（「算法」与「高级算法工程师」相似度为 0），
 * 所以只能走子串。
 *
 * **探的是整个语料，不带当前筛选。** 词退到哪一步只能由查询串和语料决定：
 * 让筛选参与，同一句话在不同筛选下会变成不同的词，于是收窄筛选反而可能
 * 搜出更多人；分面又按当前词计算，它承诺的「点了还剩几人」会随之失真。
 */
async function relaxTerm(term: string) {
	const windows: string[] = [];
	for (let len = term.length; len >= 2; len--) {
		for (let i = 0; i + len <= term.length; i++) {
			windows.push(term.slice(i, i + len));
		}
	}
	// 不足两字的词没有可退的子串。parse 已经滤掉了，这里不依赖那个跨文件约定。
	if (windows.length === 0) return term;
	const probe = await db.execute<{ t: string }>(sql`
		select c.t from (values ${sql.join(
			windows.map((w, i) => sql`(${i}::int, ${w}, ${`%${escapeLike(w)}%`})`),
			sql`, `,
		)}) as c(ord, t, pat)
		where exists (
			select 1 from experience e where ${matchExpr(sql`c.pat`)}
		)
		order by c.ord limit 1`);
	return probe.rows[0]?.t ?? term;
}

/**
 * 这些词里，哪些在语料里真实命中过至少一段经历。
 *
 * 查询理解落库前拿它给模型译的相近说法做体检（`server/turn.ts`）：语料就是
 * 词典，库里搜不到人的翻译不配上屏——和 relaxTerm、companyTags 同一条原则。
 * 体检过的 near 说法检索时不再松弛：松弛一个翻译是二次降级，两步之后
 * 屏幕上的词和实际检索的词就没有可追的关系了。
 */
export async function probeTerms(texts: string[]): Promise<Set<string>> {
	if (texts.length === 0) return new Set();
	const rows = await db.execute<{ t: string }>(sql`
		select c.t from (values ${sql.join(
			texts.map((t) => sql`(${t}, ${`%${escapeLike(t)}%`})`),
			sql`, `,
		)}) as c(t, pat)
		where exists (
			select 1 from experience e where ${matchExpr(sql`c.pat`)}
		)`);
	return new Set(rows.rows.map((r) => r.t));
}

/**
 * 命中的经历段。**返回 null 表示这次查询太宽**，不抛异常。
 *
 * 取数不带筛选：分面要回答「摘掉这一维之后还剩几人」，它需要看到被筛掉的
 * 那些行。筛选、AND、人员打分、排序与分面都在 rank.ts 对这份事实求值。
 *
 * 「你写的词覆盖了半个库」是一种查询结果，和「没有人符合」是同一档东西：
 * 用户什么都没做错，只是需要再加一个条件。抛异常会把它送进错误边界，
 * 于是这个产品最容易被触发的一种状态——搜「运营」这种两字宽词——渲染出来的
 * 是一个报错页，而旁边就摆着一整套为空结果写好的引导文案。
 */
async function fetchFacts(terms: TermPlan[]): Promise<Fact[] | null> {
	// 每条要求按说法展开：说法之间是 OR，但各自单独取，因为「命中的是哪个说法」
	// 要进证据行，而档位权重也按说法算。
	const perMember = terms.flatMap((t, i) =>
		t.members.map(
			(m, j) => sql`
			select ${i}::int as term_idx, ${j}::int as member_idx,
				${FORM_WEIGHTS[m.tier]}::float as tier_w,
				e.id, e.emp_id, e.months, e.end_date,
				e.seq_l1, e.seq_l2, e.kind,
				e.org_meta ->> 'company_tag' as company_tag,
				${routeExpr(like(m.effective))} as route
			from experience e
			where ${matchExpr(like(m.effective))}`,
		),
	);
	// 同一段被同一条要求的几个说法各命一次时只算最硬的那一次。打分层按事实
	// 累加月份（rank.ts 的 termValue），同段两行会把 12 个月数成 24；证据行
	// 也会把同一段列两遍。「贡献一次」的单位是 (要求, 段)，保留的是证据最强
	// 的那行（字眼档位 × 路权重，说法序做稳定并列）。去重必须在 SQL 里做完
	// 再过保险丝：在内存里去重的话，三个说法的宽词会把 FACT_MAX 提前引爆三倍。
	const routeWeight = sql`case route ${sql.join(
		ROUTE_ORDER.map((r) => sql`when ${r} then ${ROUTE_WEIGHTS[r]}::float`),
		sql` `,
	)} end`;
	const rows = await db.execute<{
		term_idx: number;
		member_idx: number;
		id: number;
		emp_id: string;
		months: number;
		end_date: string | null;
		seq_l1: string;
		seq_l2: string;
		kind: "internal" | "external";
		company_tag: string | null;
		route: Route;
	}>(sql`
		with hits as (${sql.join(perMember, sql` union all `)})
		select distinct on (term_idx, id)
			term_idx, member_idx, id, emp_id, months, end_date,
			seq_l1, seq_l2, kind, company_tag, route
		from hits where route is not null
		order by term_idx, id, tier_w * (${routeWeight}) desc, member_idx
		limit ${FACT_MAX + 1}`);

	if (rows.rows.length > FACT_MAX) return null;

	return rows.rows.map((r) => ({
		id: r.id,
		empId: r.emp_id,
		termIdx: r.term_idx,
		memberIdx: r.member_idx,
		tier: terms[r.term_idx]?.members[r.member_idx]?.tier ?? "full",
		route: r.route,
		months: r.months,
		endDate: r.end_date,
		seqL1: r.seq_l1,
		seqL2: r.seq_l2,
		companyTag: r.company_tag,
		kind: r.kind,
	}));
}

/**
 * 被排除词否决的**经历段**。这些段丧失为任何要求作证的资格；人不被判决——
 * 没了这些段还有别的证据的人照常进结果，只有这些段的人过不了 AND，自然出局。
 * 排除因此和「从经历找人」是同一个语义，不是一套针对人的黑名单。
 *
 * **不带当前筛选。** 否决问的是「这一段是不是 X」，答案只能由这段经历自己决定。
 * 让筛选参与，「只看在职经历」就会让入职前那段实习重新有资格作证，
 * 于是收窄一个筛选反而放出更多本来站不住的证据——和 relaxTerm 那里同一个道理。
 *
 * **词也只用用户自己说的（主词与 alts），不扩不松。** 进门的词可以扩——捞错了，
 * 人在名单上，看一眼就能纠正；赶人的词必须准——否决错了，证据无声消失，
 * 永远没人知道。
 */
async function fetchVetoed(texts: string[]): Promise<Set<number>> {
	if (texts.length === 0) return new Set();
	const pred = sql.join(
		texts.map((t) => sql`(${matchExpr(like(t))})`),
		sql` or `,
	);
	const rows = await db.execute<{ id: number }>(
		sql`select e.id from experience e where ${pred}`,
	);
	return new Set(rows.rows.map((r) => r.id));
}

/**
 * 公司档取值最多取几个。这是一条**读语料的上限**，不是模型契约：档位是个位数
 * 量级，取 100 已经是「全都要」，它挡的是脏数据把一整列不同的公司名当成档位
 * 灌进 prompt。所以它住在读它的这个文件里——`intent.ts` 不该为一条 SQL 的
 * limit 存一个常量，那会让检索层反过来依赖意图层。
 */
const COMPANY_TAG_MAX = 100;

/**
 * 语料里真实存在的公司档取值。
 *
 * 查询理解（`#/server/llm`）拿它当白名单：模型只能从库里有的档里挑一个，
 * 不许凭常识造一个「一线大厂」出来——造出来的值筛不到任何人，而界面上
 * 那一维会显示成一个选中了却空着的筛选。和 relaxTerm 一样，语料就是词典。
 */
export async function companyTags(): Promise<string[]> {
	const rows = await db.execute<{ tag: string }>(sql`
		select org_meta ->> 'company_tag' as tag
		from experience
		where org_meta ->> 'company_tag' not in ('', '未知')
		group by tag
		order by count(*) desc, tag
		limit ${COMPANY_TAG_MAX}`);
	return rows.rows.map((r) => r.tag);
}

/** 零态的词汇表最多给几个。一屏之内扫得完，再多就成了要读的正文。 */
const OVERVIEW_SEQS = 12;

/**
 * 语料概览：库有多大，以及这个库认识哪些词（见 result.ts 的 `Overview`）。
 *
 * 词汇表取二级序列，但**只留能原样当概念词用的那些**：`parseQuery` 会把
 * 「安全与风险合规」按连接词「与」切成两个词，于是点一下得到的查询和屏幕上
 * 写的那个词不是同一回事。零态的全部作用是给人一个可靠的起点，给出一个
 * 点下去就变形的起点比不给更糟，所以这里拿 `parseQuery` 自己做一次体检，
 * 过不了的直接不出现。
 */
export async function overview(): Promise<Overview> {
	const [scale, seqs] = await Promise.all([
		db.execute<{ people: number; segments: number }>(sql`
			select count(distinct emp_id)::int as people, count(*)::int as segments
			from experience`),
		// 多取一些再筛：体检刷掉几个之后仍然要能凑满一屏
		db.execute<{ seq_l2: string }>(sql`
			select seq_l2, count(distinct emp_id) as n from experience
			where seq_l2 <> '' group by seq_l2
			order by n desc limit ${OVERVIEW_SEQS * 3}`),
	]);
	const clean = seqs.rows
		.map((r) => r.seq_l2)
		.filter((name) => {
			const terms = parseQuery(name);
			return terms.length === 1 && terms[0] === name;
		});
	return {
		people: scale.rows[0]?.people ?? 0,
		segments: scale.rows[0]?.segments ?? 0,
		seqs: clean.slice(0, OVERVIEW_SEQS),
	};
}

export async function search(
	/**
	 * 这次检索的条件。**已经是 chips 了**，不是一句话也不是查询串。
	 *
	 * 一句话变成 chips 只发生一次，发生在这次查询被记录下来的时候
	 * （`server/turn.ts`）；此后每一次翻页、每一次改筛选都直接用这一份，
	 * 不重新解析、更不重新问模型。检索层因此不必知道「查询理解」存在。
	 */
	chips: Chip[],
	filters: SearchFilters = {},
	/**
	 * 要多少人。翻页靠把它调大重查，而不是靠 offset 续拉。
	 *
	 * offset 分页在这里是错的：排序键是算出来的分数，第二页的语义得是「同一次
	 * 排序里的第 51 到 100 名」，而 offset 只保证「再跑一次排序，跳过前 50」。
	 * 两次跑之间只要有一条经历落库，就会有人重复出现或整个消失，而界面上看不出来。
	 * 重拉一遍前 n 个总是自洽的。
	 */
	limit: number = RESULT_PAGE,
): Promise<SearchOutcome> {
	// 停用的 chip 在这里就消失了，此后整条链路都看不见它——检索、打分、分面、
	// 证据行一个都不必知道「停用」这回事。这是它能只花一个字段的原因。
	const active = activeChips(chips);
	const matched = active.filter(
		(c): c is Chip & { mode: "must" | "boost" } => c.mode !== "exclude",
	);
	// 否决只认用户自己说的词；parseChips 已保证排除要求没有 near。
	const vetoTexts = active.flatMap((c) =>
		c.mode === "exclude" ? [c.term, ...(c.alts ?? [])] : [],
	);
	// 一条可匹配的要求都没有（空查询、整句只写了排除词，或者全被停用了）
	// 就没有可排的人。排除词自己不产出任何人，它只否决证据段。
	if (matched.length === 0)
		return {
			terms: [],
			results: [],
			facets: emptyFacets(),
			total: 0,
			tooWide: false,
		};

	/*
	 * 每个说法的松弛探测互不依赖，一次并发打完，别串成 n 次往返。
	 *
	 * **只有 full 说法松弛。** near 说法在理解落库前已过语料体检（probeTerms），
	 * 检索时原样用——松弛一个翻译是二次降级。**排除词完全不松弛**：松弛用在
	 * 否决上是一把没瞄准的枪（「量子炼金」退成「金」会把「资金」「基金」的
	 * 经历整片否决，而界面上只显示用户写的那个词）。搜不到的排除词什么段都
	 * 否决不了，这正是它该有的样子。
	 */
	const terms: TermPlan[] = await Promise.all(
		matched.map(async (c) => {
			const members: MemberPlan[] = await Promise.all(
				[c.term, ...(c.alts ?? [])].map(async (text) => ({
					text,
					effective: await relaxTerm(text),
					tier: "full" as const,
				})),
			);
			for (const text of c.near ?? [])
				members.push({ text, effective: text, tier: "near" });
			return { term: c.term, members, mode: c.mode };
		}),
	);

	// 事实与否决段集合互不依赖，同时发出去
	const [all, vetoed] = await Promise.all([
		fetchFacts(terms),
		fetchVetoed(vetoTexts),
	]);
	// 太宽的那一支：词是解析出来了（证据行还要拿它排列），只是没有结果可给。
	if (all === null)
		return {
			terms,
			results: [],
			facets: emptyFacets(),
			total: 0,
			tooWide: true,
		};
	const facts = vetoed.size ? all.filter((f) => !vetoed.has(f.id)) : all;

	const { ranked, facets, total } = rank(facts, terms, filters, new Date());
	const page = ranked.slice(0, sanitizeLimit(limit));
	if (page.length === 0)
		return { terms, results: [], facets, total, tooWide: false };

	const empIds = page.map((r) => r.empId);
	const evidence = pageHits(facts, filters, new Set(empIds), HITS_PER_TERM);

	// 展示用的原文按 id 直取，不再重跑一遍命中判定：名次已经定了，这里要的是
	// 那几段经历长什么样，和「它为什么命中」无关。
	const ids = [...new Set([...evidence.values()].flat().map((f) => f.id))];
	const [segments, employees] = await Promise.all([
		db.select().from(experience).where(inArray(experience.id, ids)),
		db
			.select({
				empId: employee.empId,
				name: employee.name,
				curDept: employee.curDept,
				curTitle: employee.curTitle,
				curLevel: employee.curLevel,
			})
			.from(employee)
			.where(inArray(employee.empId, empIds)),
	]);

	const segById = new Map(segments.map((s) => [s.id, s]));
	const empById = new Map(employees.map((e) => [e.empId, e]));

	const results: SearchResult[] = [];
	for (const row of page) {
		const emp = empById.get(row.empId);
		if (!emp) continue;
		const hits: Hit[] = [];
		for (const f of evidence.get(row.empId) ?? []) {
			const s = segById.get(f.id);
			if (!s) continue;
			hits.push({
				experienceId: s.id,
				term: terms[f.termIdx]?.term ?? "",
				matched:
					terms[f.termIdx]?.members[f.memberIdx]?.effective ??
					terms[f.termIdx]?.term ??
					"",
				route: f.route,
				kind: s.kind,
				startDate: s.startDate,
				endDate: s.endDate,
				org: s.org,
				title: s.title,
				seq: seqLabel(s.seqL1, s.seqL2, s.seqL3),
				months: s.months,
			});
		}
		results.push({ employee: emp, score: row.score, basis: row.basis, hits });
	}
	return { terms, results, facets, total, tooWide: false };
}
