import { cn } from "@cloudflare/kumo";
import type { Experience } from "#/db/schema";
import { duration, period } from "#/lib/format";
import { bestStrength } from "#/search/evidence";
import type { Hit } from "#/search/result";
import { BAND_FILL } from "./evidence";

/**
 * 职业轨迹条：把一个人的经历段按**真实年份**画成一条带子。
 *
 * 下面那串卡片能回答「他做过什么」，回答不了「他的路径长什么样」——起止年份
 * 只活在每张卡片的文字里，要看出「在哪几年、跨了几家、有没有空窗、命中的那段
 * 落在职业生涯的哪个位置」，得逐条读日期再在脑子里排一遍。经历段是这个产品
 * 唯一独有的数据，值得把它本身的形状画出来。
 *
 * 编码分两层，各管一件事，互不挪用：
 *
 * - **高度管「这一段命中了没有」**：命中段占满整条轨，未命中段是轨中间的一道
 *   细线。不靠颜色分是因为 Kumo 的几档灰全挤在 92%–93.5% 之间（hairline 93.5 /
 *   fill 92.2 / line 是 10% 的黑）——做 8px 的点够用，做色带分不开。
 * - **颜色管「这一段的证据有多硬」**：三档取自点阵那一套（evidence.tsx 的
 *   BAND_FILL），所以橙色在这里仍然只表示受控字段命中，和表格、时间轴、图例
 *   完全同义。未命中段永远不上色，不存在「橙 = 命中」这层含义。
 *
 * 带子不按 kind 切段（在职与入职前连续排，理由见 timeline.tsx），转折点由
 * 那根「入职」竖线说明——一条线，不是两条带子。
 */

/** 一条轨的高度与轨间距（px）。 */
const LANE_H = 8;
const LANE_GAP = 3;

/** 未命中段那道细线的粗细（px）。 */
const MISS_H = 2;

/** 命中段的最小宽度（px）：再窄，「仅简历自述」那一档的描边就糊成一团了。 */
const MIN_HIT_W = 6;

/** 未命中段的最小宽度（px）：只要存在过就得看得见，哪怕只有一个月。 */
const MIN_W = 2;

/** 「入职」这个标签离两端太近就不画，只留竖线——否则它会压住两头的年份。 */
const LABEL_SAFE = 0.16;

/** 年月 → 可做差的整数。日不参与：这条带子的分辨率是月。 */
export function ym(date: string) {
	const [y = "0", m = "1"] = date.split("-");
	return Number(y) * 12 + Number(m) - 1;
}

/**
 * 把重叠的经历段分到不同的轨上。
 *
 * **重叠在真实数据里是常态，不是脏数据**：入职前经历来自工作经历表、在职经历
 * 来自异动流程，同一段时间在两张表里各登记一次很正常（同一家公司入职前后各
 * 一条，起始月甚至相同）。单轨绝对定位下，后画的那条会把前一条整个盖住——
 * 带子少画了一段经历，而看的人完全无从察觉。
 *
 * 贪心装箱：按开始时间排，每一段放进第一条「已经空出来」的轨。这样重叠的
 * 段被摞起来，眼睛看到的就是「这两段是并行的」——那是事实，不是缺陷。
 * 不重叠的人只会得到一条轨，带子还是一条线。
 *
 * 导出是为了单测：这段几何算错了页面上只是"看起来怪"，没有任何断言会红。
 */
export function packLanes(spans: { start: number; end: number }[]): number[] {
	const laneEnds: number[] = [];
	const order = spans
		.map((s, i) => ({ ...s, i }))
		.sort((a, b) => a.start - b.start || a.i - b.i);
	const lanes = new Array<number>(spans.length).fill(0);
	for (const s of order) {
		let lane = laneEnds.findIndex((end) => end <= s.start);
		if (lane < 0) lane = laneEnds.length;
		laneEnds[lane] = s.end;
		lanes[s.i] = lane;
	}
	return lanes;
}

export function CareerBar({
	rows,
	hitIndex,
	hireDate,
}: {
	rows: Experience[];
	hitIndex: Map<number, Hit[]>;
	hireDate: string | null;
}) {
	// 一段经历都没有就没有形状可画，不留一条空带子在那里。
	if (rows.length === 0) return null;

	const now = new Date().toISOString().slice(0, 10);
	const spans = rows.map((x) => ({
		start: ym(x.startDate),
		end: ym(x.endDate ?? now),
	}));
	const from = Math.min(...spans.map((s) => s.start));
	// 至少一年宽：同一年内的单段经历会让跨度归零，除法就成了 NaN。
	const to = Math.max(Math.max(...spans.map((s) => s.end)), from + 12);
	const span = to - from;
	const pct = (months: number) => (months / span) * 100;

	const lanes = packLanes(spans);
	const laneCount = Math.max(...lanes) + 1;
	const height = laneCount * LANE_H + (laneCount - 1) * LANE_GAP;

	const hire = hireDate ? ym(hireDate) : null;
	// 入职日不在当前经历跨度内时不画，避免把标记钉在边界外
	const hireAt = hire !== null && hire > from && hire < to ? hire : null;
	const hireFrac = hireAt === null ? 0 : (hireAt - from) / span;
	const showHireLabel =
		hireAt !== null && hireFrac > LABEL_SAFE && hireFrac < 1 - LABEL_SAFE;

	return (
		<figure className="mb-4">
			<div className="relative" style={{ height }}>
				{rows.map((x, i) => {
					const strength = bestStrength(hitIndex.get(x.id));
					const s = spans[i];
					if (!s) return null;
					const laneTop = (lanes[i] ?? 0) * (LANE_H + LANE_GAP);
					return (
						<button
							aria-label={`${x.org} ${x.title}，${period(x.startDate, x.endDate)}，${duration(x.months)}${strength ? "，与本次条件相关" : ""}`}
							// 方角：色块最窄只有 2px，任何圆角都只会把它啃掉一半
							className={cn(
								"absolute after:absolute after:-inset-x-1 after:-inset-y-4 after:content-['']",
								strength ? BAND_FILL[strength] : "bg-kumo-hairline",
							)}
							/* 一条轨只有 8px 高，按压缩放会让整条带子抖一下 */
							data-press="off"
							key={x.id}
							/* 点色块滚到对应的那张卡片：带子给形状，卡片给细节，
							   两者之间要有一条路，否则带子只是装饰。 */
							onClick={() =>
								document
									.getElementById(`exp-${x.id}`)
									?.scrollIntoView({ block: "center", behavior: "smooth" })
							}
							style={{
								left: `${pct(s.start - from)}%`,
								width: `${pct(Math.max(s.end - s.start, 1))}%`,
								minWidth: strength ? MIN_HIT_W : MIN_W,
								// 命中占满这条轨，未命中是轨中间的一道细线
								top: strength ? laneTop : laneTop + (LANE_H - MISS_H) / 2,
								height: strength ? LANE_H : MISS_H,
							}}
							title={`${x.org} · ${x.title} · ${period(x.startDate, x.endDate)}`}
							type="button"
						/>
					);
				})}

				{/*
				 * 入职这一刻。它是这条带子上唯一的转折点，也是「入职前经历」在图上的
				 * 唯一说明——不把带子切成两截，只画一条线。contrast 是全站最深的那一档，
				 * 在一片浅灰上不会和任何语义色撞车。
				 */}
				{hireAt !== null && (
					<span
						aria-hidden="true"
						className="absolute top-0 bottom-0 w-px bg-kumo-contrast"
						style={{ left: `${hireFrac * 100}%` }}
					/>
				)}
			</div>

			{/*
			 * 刻度只有三个：起点年、入职年、至今。年份密排会把 26rem 宽的详情栏塞满
			 * 数字，而这条带子要回答的是「大致在哪几年」——精确的那一份就在下面每张
			 * 卡片的第二行，一个都没丢。
			 */}
			<figcaption className="relative mt-1.5 h-4 text-kumo-subtle text-xs tabular-nums">
				<span className="absolute left-0">{Math.floor(from / 12)}</span>
				{showHireLabel && hireAt !== null && (
					<span
						className="-translate-x-1/2 absolute whitespace-nowrap"
						style={{ left: `${hireFrac * 100}%` }}
					>
						入职 {Math.floor(hireAt / 12)}
					</span>
				)}
				<span className="absolute right-0">至今</span>
			</figcaption>
		</figure>
	);
}
