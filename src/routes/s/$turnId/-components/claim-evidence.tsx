import { Popover } from "#/components/ui/popover";
import { ProgressTag } from "#/components/ui/progress-tag";
import { dots, years } from "#/lib/format";
import { placeOf } from "#/search/result";
import type { ClaimLine } from "../-lib/claim-lines";
import { EvidenceLine, MissedClaims } from "./evidence";

/*
 * 一个人在各条主张上的证据，三种画法：名单一行的第二行（`ClaimRow`）、行尾的
 * 进度标签（`ClaimProgress`）和点开它的气泡里逐条的依据（`ClaimEvidence`）。
 */

export function ClaimEvidence({ lines }: { lines: ClaimLine[] }) {
	const missed = lines.filter((l) => !l.found).map((l) => l.claim.label);
	return (
		<div className="flex flex-col gap-1">
			{lines.map(
				({ claim, found }) =>
					found && (
						<EvidenceLine
							basis={found.basis}
							boost={claim.mode === "boost"}
							evidence={found.evidence}
							key={claim.id}
							name={claim.label}
						/>
					),
			)}
			<MissedClaims names={missed} />
		</div>
	);
}

/**
 * 名单一行的第二行：这个人凭哪段经历进的名单。写第一条命中的主张里最对得上的那一段：
 * 是现在这份任职时写「现任岗位」，不重抄第一行的部门和岗位；不止一段时写出段数，时长写
 * 累计（排名用的就是累计）。哪几段在人的详情里铺底标出，条件名只在条件那一排出现。
 * 只占一行，没有命中的主张时空着，行高不变。
 */
export function ClaimRow({ lines }: { lines: ClaimLine[] }) {
	const found = lines.find((l) => l.found)?.found;
	return (
		<p className="mt-1 flex h-(--text-xs--line-height) min-w-0 items-baseline whitespace-pre text-fg-secondary text-xs">
			{found && <RowEvidence found={found} />}
		</p>
	);
}

function RowEvidence({ found }: { found: NonNullable<ClaimLine["found"]> }) {
	const { evidence: segment, segments, basis } = found;
	// 公司内、还没结束的一段就是现在这份任职
	const current = !segment.company && segment.endDate === null;
	const span =
		segments > 1
			? `累计 ${years(basis.months)}`
			: current
				? years(basis.months)
				: `${basis.external ? "入职前" : "公司内"} ${years(basis.months)}`;
	return (
		<>
			<span className="truncate">
				{current ? "现任岗位" : dots(placeOf(segment), segment.title)}
				{segments > 1 && (
					<span className="text-fg-tertiary"> 等 {segments} 段</span>
				)}
			</span>
			<span className="shrink-0 text-fg-tertiary tabular-nums">
				{` · ${span}`}
			</span>
		</>
	);
}

export function ClaimProgress({
	name,
	lines,
}: {
	name: string;
	lines: ClaimLine[];
}) {
	const met = lines.filter((l) => l.found).length;
	return (
		<Popover
			content={
				<div className="w-(--container-detail) max-w-full">
					<ClaimEvidence lines={lines} />
				</div>
			}
			placement="bottomRight"
			popupProps={{ "aria-label": `${name}的匹配依据` }}
			trigger="click"
		>
			<ProgressTag
				aria-label={`命中 ${met} 条，共 ${lines.length} 条，查看${name}的匹配依据`}
				total={lines.length}
				value={met}
			/>
		</Popover>
	);
}
