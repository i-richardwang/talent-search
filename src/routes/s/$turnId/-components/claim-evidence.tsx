import { ClaimMarks, EvidenceLine, MissedClaims } from "#/components/evidence";
import { Popover } from "#/components/ui/popover";
import { ProgressTag } from "#/components/ui/progress-tag";
import { conditionKey } from "#/search/condition";
import { strengthOf } from "#/search/evidence";
import type { ClaimLine } from "../-lib/claim-lines";

/*
 * 一个人在各条主张上的证据，三种画法：名单一行里的一排词（`ClaimRow`）、行尾的
 * 进度标签（`ClaimProgress`）和点开它的气泡、人的详情里逐条的依据（`ClaimEvidence`）。
 */

/** 逐条的依据：命中的一条一行证据，没命中的合成最后一行。 */
export function ClaimEvidence({ lines }: { lines: ClaimLine[] }) {
	const missed = lines.filter((l) => !l.found).map((l) => l.name);
	return (
		<div className="flex flex-col gap-1">
			{lines.map(
				({ claim, name, found }) =>
					found && (
						<EvidenceLine
							basis={found.basis}
							boost={claim.mode === "boost"}
							hit={found.hit}
							key={conditionKey(claim)}
							name={name}
						/>
					),
			)}
			<MissedClaims names={missed} />
		</div>
	);
}

/** 名单一行的第二行：每条主张一个词和一颗点，顺序和条件那一排相同。 */
export function ClaimRow({ lines }: { lines: ClaimLine[] }) {
	return (
		<ClaimMarks
			className="mt-1"
			marks={lines.map(({ name, found }) => ({
				name,
				strength: found ? strengthOf(found.hit.route) : undefined,
			}))}
		/>
	);
}

/** 行尾的进度标签：几条里命中了几条，点开是逐条的依据。 */
export function ClaimProgress({
	name,
	lines,
}: {
	name: string;
	lines: ClaimLine[];
}) {
	const hit = lines.filter((l) => l.found).length;
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
				aria-label={`命中 ${hit} 条，共 ${lines.length} 条，查看${name}的匹配依据`}
				total={lines.length}
				value={hit}
			/>
		</Popover>
	);
}
