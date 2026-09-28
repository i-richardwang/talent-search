import { useState } from "react";
import { Segmented } from "#/components/ui/segmented";
import { PageHeader } from "#/routes/-components/page-header";
import {
	Person,
	PersonNotFound,
	PersonPending,
} from "#/routes/s/$turnId/-components/person";
import { SidePanel } from "#/routes/s/$turnId/-components/side-panel";
import { claimLines } from "#/routes/s/$turnId/-lib/claim-lines";
import { claimName } from "#/search/condition-label";
import { Routed } from "../../routed";
import { CLAIMS } from "../../samples/conditions";
import { EMPLOYEES, experiencesOf, resultOf } from "../../samples/people";
import { LATEST_TURN_ID } from "../../samples/thread";
import { Shell } from "./home";

/*
 * 人的详情：`src/routes/s/$turnId/-components/person.tsx` 的三种内容（详情、换人途中、
 * 找不到），数据换成样例里的候选人和这次搜索的命中。搜索结果页那一页的右栏也用这里的
 * `PersonPane`。
 */

const NAMES = CLAIMS.map(claimName);

/** 样例里一个人的详情；工号不在样例里就是找不到。 */
export function PersonPane({ empId }: { empId: string }) {
	const employee = EMPLOYEES.find((row) => row.empId === empId);
	if (!employee) return <PersonNotFound />;
	const result = resultOf(empId);
	return (
		<Person
			employee={employee}
			hits={result?.hits ?? []}
			lines={result ? claimLines(result, CLAIMS) : []}
			names={NAMES}
			timeline={experiencesOf(empId)}
		/>
	);
}

type State = "loaded" | "pending" | "missing";

/**
 * 人的详情单独成页：产品外壳的内容卡片里，产品的右栏放在正中，页头右端是切换状态和
 * 候选人的控件。
 */
export function DetailPage() {
	const [empId, setEmpId] = useState("T0101");
	const [state, setState] = useState<State>("loaded");
	return (
		<Routed url={`/s/${LATEST_TURN_ID}/p/${empId}`}>
			<Shell>
				<PageHeader
					right={
						<div className="flex flex-wrap items-center gap-2">
							<Segmented<State>
								aria-label="状态"
								onChange={setState}
								options={[
									{ label: "详情", value: "loaded" },
									{ label: "换人途中", value: "pending" },
									{ label: "找不到", value: "missing" },
								]}
								size="small"
								value={state}
							/>
							<Segmented<string>
								aria-label="候选人"
								onChange={setEmpId}
								options={EMPLOYEES.map((e) => ({
									label: e.name,
									value: e.empId,
								}))}
								size="small"
								value={empId}
							/>
						</div>
					}
					title="人的详情"
				/>
				<div className="flex min-h-0 flex-1 justify-center">
					<SidePanel
						conversation={null}
						detail={
							state === "loaded" ? (
								<PersonPane empId={empId} />
							) : state === "pending" ? (
								<PersonPending />
							) : (
								<PersonNotFound />
							)
						}
					/>
				</div>
			</Shell>
		</Routed>
	);
}
