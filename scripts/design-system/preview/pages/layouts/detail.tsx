import { useState } from "react";
import { Segmented } from "#/components/ui/segmented";
import {
	Person,
	PersonNotFound,
	PersonPending,
} from "#/routes/s/$turnId/-components/person";
import { SidePanel } from "#/routes/s/$turnId/-components/side-panel";
import { claimName } from "#/search/condition-label";
import { Routed } from "../../routed";
import { CLAIMS } from "../../samples/conditions";
import { EMPLOYEES, experiencesOf, hitsOf } from "../../samples/people";
import { LATEST_TURN_ID } from "../../samples/thread";

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
	return (
		<Person
			employee={employee}
			hits={hitsOf(empId)}
			names={NAMES}
			timeline={experiencesOf(empId)}
		/>
	);
}

type State = "loaded" | "pending" | "missing";

/** 人的详情单独成页：产品的右栏放在页中间，上面是切换候选人和状态的控件。 */
export function DetailPage() {
	const [empId, setEmpId] = useState("T0101");
	const [state, setState] = useState<State>("loaded");
	return (
		<Routed url={`/s/${LATEST_TURN_ID}/p/${empId}`}>
			<div className="flex h-dvh flex-col">
				<header className="app-column flex flex-wrap items-end justify-between gap-x-5 gap-y-3 border-b py-5">
					<h1 className="font-semibold text-xl">人的详情</h1>
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
				</header>
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
			</div>
		</Routed>
	);
}
