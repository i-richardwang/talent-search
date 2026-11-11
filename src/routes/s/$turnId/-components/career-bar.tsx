import { duration, period } from "#/lib/format";
import { cn } from "#/lib/utils";
import { type EmployeeDetail, placeOf } from "#/search/result";
import { EVIDENCE_FILL } from "./evidence";

/**
 * 职业轨迹条：一个人的经历段按真实年份排成一条带子。有证据的段占满一条轨、和证据行的
 * 点同色（`EVIDENCE_FILL`），没有的是轨中间一道细条；入职日画一根竖线。
 */

const LANE_H = 10;
const LANE_GAP = 4;
const MISS_H = 4;
/** 相邻两段之间留的缝。 */
const SEAM = 2;

/** 有证据的段的最小宽度（px）：再窄就和没有证据的细条分不开了。 */
const MIN_EVIDENCE_W = 8;

/** 没有证据的段的最小宽度（px）：只有一个月也看得见。 */
const MIN_W = 4;

/** 「入职」标签离两端太近就只画竖线，不压住两头的年份。 */
const LABEL_SAFE = 0.16;

/** 年月 → 可做差的整数。日不参与：这条带子的分辨率是月。 */
export function ym(date: string) {
	const [y = "0", m = "1"] = date.split("-");
	return Number(y) * 12 + Number(m) - 1;
}

/**
 * 把重叠的经历段分到不同的轨上。入职前与在职的记录来自两张表，同一段时间各登记一次
 * 是常态；放在一条轨上，后画的会把前一段整个盖住。
 *
 * 贪心装箱：按开始时间排，每一段放进第一条已经空出来的轨；不重叠的人只有一条轨。
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
	counted,
	hireDate,
}: {
	rows: EmployeeDetail["timeline"];
	/** 算数的经历段（`claim-lines.ts` 的 `countedOf`）。 */
	counted: ReadonlySet<number>;
	hireDate: string | null;
}) {
	if (rows.length === 0) return null;

	const now = new Date().toISOString().slice(0, 10);
	const spans = rows.map((x) => ({
		start: ym(x.startDate),
		end: ym(x.endDate ?? now),
	}));
	const from = Math.min(...spans.map((s) => s.start));
	const to = Math.max(...spans.map((s) => s.end));
	const endLabel = rows.some((row) => row.endDate === null)
		? "至今"
		: Math.floor(to / 12);
	// 月是轨迹条的最小分辨率，同月开始结束也保留一个月的宽度。
	const span = Math.max(to - from, 1);
	const pct = (months: number) => (months / span) * 100;

	const lanes = packLanes(spans);
	const laneCount = Math.max(...lanes) + 1;
	const height = laneCount * LANE_H + (laneCount - 1) * LANE_GAP;

	const hire = hireDate ? ym(hireDate) : null;
	const hireAt = hire !== null && hire > from && hire < to ? hire : null;
	const hireFrac = hireAt === null ? 0 : (hireAt - from) / span;
	const showHireLabel =
		hireAt !== null && hireFrac > LABEL_SAFE && hireFrac < 1 - LABEL_SAFE;

	return (
		<figure className="mb-4">
			<div className="relative" style={{ height }}>
				{rows.map((x, i) => {
					const hit = counted.has(x.id);
					const s = spans[i];
					if (!s) return null;
					const laneTop = (lanes[i] ?? 0) * (LANE_H + LANE_GAP);
					return (
						<button
							aria-label={`${placeOf(x)} ${x.title}，${period(x.startDate, x.endDate)}，${duration(x.months)}${hit ? "，与本次条件相关" : ""}`}
							className={cn(
								"absolute rounded-xs after:absolute after:-inset-x-1 after:-inset-y-4 after:content-['']",
								hit ? EVIDENCE_FILL : "bg-fill",
							)}
							key={x.id}
							onClick={() =>
								document
									.getElementById(`exp-${x.id}`)
									?.scrollIntoView({ block: "center", behavior: "smooth" })
							}
							style={{
								left: `${pct(s.start - from)}%`,
								width: `calc(${pct(Math.max(s.end - s.start, 1))}% - ${SEAM}px)`,
								minWidth: hit ? MIN_EVIDENCE_W : MIN_W,
								top: hit ? laneTop : laneTop + (LANE_H - MISS_H) / 2,
								height: hit ? LANE_H : MISS_H,
							}}
							type="button"
						/>
					);
				})}

				{hireAt !== null && (
					<span
						aria-hidden="true"
						className="absolute top-0 bottom-0 w-px bg-fg"
						style={{ left: `${hireFrac * 100}%` }}
					/>
				)}
			</div>

			{/* 标签与轨迹条共用时间范围；精确起止在时间线里。 */}
			<figcaption className="relative mt-1.5 h-4 text-fg-secondary text-xs tabular-nums">
				<span className="absolute left-0">{Math.floor(from / 12)}</span>
				{showHireLabel && hireAt !== null && (
					<span
						className="-translate-x-1/2 absolute whitespace-nowrap"
						style={{ left: `${hireFrac * 100}%` }}
					>
						入职 {Math.floor(hireAt / 12)}
					</span>
				)}
				<span className="absolute right-0">{endLabel}</span>
			</figcaption>
		</figure>
	);
}
