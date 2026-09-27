import { Link } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";
import { Alert } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";

/**
 * 正看着的不是最后一次的结果。名单那一列说出来：窄屏上线程收着，只有这里看得见。
 * 在这里改条件、补充需求照常可以，作用在眼前这份条件上，记在最后。
 */
export function Earlier({ latestId }: { latestId: string }) {
	return (
		<Alert
			action={
				<Button
					render={
						<Link params={{ turnId: latestId }} search={{}} to="/s/$turnId" />
					}
					size="small"
				>
					回到最新
				</Button>
			}
			icon={HistoryIcon}
			title="正在查看较早的一次结果。在此基础上修改，会记为最新的一次。"
			type="info"
		/>
	);
}
