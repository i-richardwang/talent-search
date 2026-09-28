import { Block } from "#/components/ui/block";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";

/** 流程的一步：步骤名、用户做什么、界面怎么回应。 */
export type FlowStep = [step: string, does: string, answers: string];

/** 一个模式的流程表。 */
export function FlowTable({ steps }: { steps: readonly FlowStep[] }) {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>步骤</TableHead>
						<TableHead>用户做什么</TableHead>
						<TableHead>界面怎么回应</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{steps.map(([step, does, answers]) => (
						<TableRow key={step}>
							<TableCell className="whitespace-nowrap font-medium">
								{step}
							</TableCell>
							<TableCell className="text-fg-secondary">{does}</TableCell>
							<TableCell>{answers}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}
