import { Block } from "#/components/ui/block";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { dots, integer, period } from "#/lib/format";
import type { StreamCoverage } from "#/server/data";

/**
 * 数据页上方的记录流：每条流（绩效、高潜池）有多少人有记录、从哪一期到哪一期、最近一期。
 * 数据源没有记录流时不画：那是数据源的形态，不是要处理的问题。
 */
export function StreamTable({ streams }: { streams: StreamCoverage[] }) {
	if (streams.length === 0) return null;
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table narrow="cards">
				<TableHeader>
					<TableRow>
						<TableHead>记录</TableHead>
						<TableHead className="w-full">覆盖</TableHead>
						<TableHead>最近一期</TableHead>
						<TableHead className="text-end">人数</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{streams.map((s) => (
						<TableRow key={s.stream}>
							<TableCell cellSlot="title" className="whitespace-nowrap">
								{s.label}
							</TableCell>
							<TableCell cellLabel="覆盖" className="text-fg-secondary">
								{coverage(s)}
							</TableCell>
							<TableCell
								cellLabel="最近一期"
								className="whitespace-nowrap text-fg-secondary tabular-nums"
							>
								{s.latest ? period(s.latest.start, s.latest.end) : "—"}
							</TableCell>
							<TableCell
								cellLabel="人数"
								className="whitespace-nowrap text-end tabular-nums"
							>
								{integer(s.people)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

/** 评级写一期多长、一共几期、从哪一期起；状态写进出几次、从哪天起。 */
function coverage(s: StreamCoverage) {
	if (!s.first) return "还没有记录";
	return s.kind === "rating"
		? dots(
				s.period ? `${s.period}一期` : null,
				`${integer(s.periods)} 期`,
				`${s.first.slice(0, 7)} 起`,
			)
		: dots("状态", `${integer(s.periods)} 次进入`, `${s.first.slice(0, 7)} 起`);
}
