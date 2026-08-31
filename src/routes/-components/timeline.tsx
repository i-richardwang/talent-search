import { Badge, Text } from "@cloudflare/kumo";
import type { CompanyMeta, Experience } from "#/db/schema";
import { duration, period, seqLabel } from "#/lib/format";
import { bestStrength } from "#/search/evidence";
import type { Hit } from "#/search/result";
import { Dot, Highlight, ROUTE_LABEL } from "./evidence";

/** 命中段按 experienceId 索引，一段可能同时命中多个概念词 */
type HitIndex = Map<number, Hit[]>;

export function buildHitIndex(hits: Hit[]): HitIndex {
	const index: HitIndex = new Map();
	for (const h of hits) {
		const list = index.get(h.experienceId);
		if (list) list.push(h);
		else index.set(h.experienceId, [h]);
	}
	return index;
}

export function Timeline({
	rows,
	hitIndex,
}: {
	rows: Experience[];
	hitIndex: HitIndex;
}) {
	// 倒序：最近的经历在最上面。在职与入职前连续排，不切成两段——
	// 一个人的职业轨迹本来就是连续的，按来源切开会掩盖跨越的那一步。
	const ordered = [...rows].reverse();

	return (
		/*
		 * 这里没有逐条浮出的动画：整个详情栏已经在换人时淡入一次（settle）。
		 * 两层动画叠在一起节奏会互相干扰，时间轴长的时候后面几条还要等前面跑完。
		 * 一个签名动作做透，好过两个各做一半。
		 */
		<ol className="pt-0.5">
			{ordered.map((x, i) => (
				<Segment
					hits={hitIndex.get(x.id)}
					isLast={i === ordered.length - 1}
					key={x.id}
					row={x}
				/>
			))}
		</ol>
	);
}

function Segment({
	row: x,
	hits,
	isLast,
}: {
	row: Experience;
	hits: Hit[] | undefined;
	isLast: boolean;
}) {
	const external = x.kind === "external";
	// 这一段最硬的那一路。节点就是全站那颗点，不另画一套。
	const strength = bestStrength(hits);
	const seq = seqLabel(x.seqL1, x.seqL2, x.seqL3);
	// 简历路的命中不一定排在第一条：这一段可能先因序列命中了别的词。
	// 只要有任意一个词是从原文命中的，就得把那个词在原文里标出来。
	const claimed = hits?.find((h) => h.route === "description");

	return (
		<li
			/* 职业轨迹条上的色块点过来时滚到这里（career-bar.tsx） */
			id={`exp-${x.id}`}
			/*
			 * 两列：轴 + 卡片。没有单独的起始月列——卡片第二行已经写着
			 * 「2021-03 – 2024-10 · 2 年 3 个月」，再列一遍是同一份数据信息
			 * 更少的第二次渲染。省下的 4.75rem 让 26rem 宽的详情栏里中文一行从
			 * 18 字涨到 23 字，简历原文才读得下去。
			 */
			className="relative grid grid-cols-[0.75rem_1fr] gap-x-3 pb-2"
		>
			{/*
			 * 脊线与节点都由这一列的中线负责，不用魔法偏移量对齐。
			 *
			 * 节点直接用全站那颗 Dot，说的是同一件事：这一段的证据有多硬。
			 * 另画一颗「命中/未命中」的点会让实心橙在表格里是强证据、在这里是
			 * 任意证据，用户学的编码一换视图就失效。
			 *
			 * 「入职前」不占用空心节点——空心在点阵里已经是「仅简历自述」，
			 * 一个形状两个意思是编码本身的错。右边那个「入职前」标签说一遍就够。
			 */}
			<span className="relative flex flex-col items-center pt-2">
				<Dot
					className="z-raise size-2.5 ring-2 ring-kumo-base"
					strength={strength}
				/>
				{!isLast && <span className="w-px flex-1 bg-kumo-hairline" />}
			</span>

			<div className="min-w-0 rounded-sheet px-3 py-2">
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
					<Text as="span" bold size="base">
						{x.org}
					</Text>
					<Text as="span" size="base">
						{x.title}
					</Text>
					{x.level && (
						<Text as="span" size="xs" variant="secondary">
							{x.level}
						</Text>
					)}
					{/*
					 * outline 而不是 neutral：neutral 是实心深底白字，会成为整张
					 * 卡片里对比最高的一块，而它标的是最不需要强调的东西——顺序
					 * 本身已经说明这段在入职之前。同一张卡片里下面那排命中词也是
					 * outline，两种 badge 只差填充会让人以为它们是两类东西。
					 */}
					{external && <Badge variant="outline">入职前</Badge>}
				</div>

				{/*
				 * 这一行的三样东西是同一类：这一段的元数据。所以同一档字号。
				 * mono 变体在 Kumo 里恒是 13（size 只有 lg 能把它抬到 14），
				 * 所以另外两个跟到 13，而不是把日期压到 12——同一行里两个角色
				 * 相同的标注差一档，是「这一行没人量过」的样子。
				 */}
				<div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
					<Text as="span" variant="mono-secondary">
						<span className="tabular-nums">
							{period(x.startDate, x.endDate)} · {duration(x.months)}
						</span>
					</Text>
					{seq && (
						<Text as="span" size="sm" variant="secondary">
							{seq}
						</Text>
					)}
					{x.orgMeta && <CompanyLine meta={x.orgMeta} />}
				</div>

				{hits && hits.length > 0 && <MatchedTerms hits={hits} />}

				{/*
				 * 简历原文是这一栏唯一成段的密集文本，也是最弱的一路证据
				 * （weights.ts 里 0.25）。它必须比卡片自己的标题小一档：
				 * 和「公司 岗位」同为 14 时，一张卡片里最长、最不可信的那块
				 * 反而和标题一样重，卡片内部就没有层次了。13 配 read-cjk 的
				 * 1.8 行高仍然是可连读的正文；12 是标签档，成段汉字用它会累。
				 */}
				{x.description && (
					<p className="read-cjk mt-2 text-kumo-subtle text-sm" lang="zh">
						{claimed ? (
							<Highlight term={claimed.term} text={x.description} />
						) : (
							x.description
						)}
					</p>
				)}

				{/* mt 挂在外层：Kumo 的 `Text` 刻意不收 className。
				    不留这一格，部门路径会直接粘在上面那段简历原文的末行上。 */}
				{!external && x.orgPath && (
					<div className="mt-1.5">
						<Text size="xs" variant="secondary">
							{x.orgPath}
						</Text>
					</div>
				)}
			</div>
		</li>
	);
}

/**
 * 这一段为哪些概念词提供了证据，以及走的哪一路。
 *
 * 全部 outline，不按强度上色：强度是从 route 推导的，而 route 就写在标签正文里，
 * 上色等于同一份数据画两遍。强度归节点管（一段一个），路径归标签管
 * （一段可能有几个词各走各的路），两者不重叠。
 */
function MatchedTerms({ hits }: { hits: Hit[] }) {
	const seen = new Set<string>();
	const unique = hits.filter((h) => !seen.has(h.term) && seen.add(h.term));

	return (
		<div className="mt-2 flex flex-wrap items-center gap-1.5">
			{unique.map((h) => (
				<Badge key={h.term} variant="outline">
					{h.term} · {ROUTE_LABEL[h.route]}
				</Badge>
			))}
		</div>
	);
}

function CompanyLine({ meta }: { meta: CompanyMeta }) {
	const parts = [meta.company_tag, meta.industry, meta.nature].filter(
		(v) => v && v !== "未知",
	);
	if (!parts.length) return null;
	// 13：和同一行的起止年月、序列同档，见上
	return (
		<Text as="span" size="sm" variant="secondary">
			{parts.join(" · ")}
		</Text>
	);
}
