import { confirmModal } from "#/components/ui/modal";
import { toast } from "#/components/ui/toast";
import type { Rejudge } from "#/lib/task";
import { rejudgeTerms } from "#/server/functions";

/** 整批退回之前问的那一句：范围一大，重新判定要花的时间和模型调用就多。 */
const WHOLE = {
	all: {
		content:
			"词表里的每个词都会重新判定一遍，词多时要跑很久。判定生效之前，现有的标签照常使用。",
		title: "重新判定整张词表",
	},
	excluded: {
		content:
			"判成不是能力的词都会重新判定一遍。判定生效之前，它们仍然不出现在筛选和候选词里。",
		title: "重新判定全部不是能力的词",
	},
} as const;

async function send(rejudge: Rejudge) {
	try {
		const outcome = await rejudgeTerms({ data: rejudge });
		if (outcome === "queued")
			toast.success({
				description: "这一轮整理跑完后这里会更新，进度在任务页。",
				title: "已开始重新判定",
			});
		else
			toast.warning(
				outcome === "off"
					? {
							description: "先在部署配置里开启整理。",
							title: "整理没有开启，没有重新判定",
						}
					: {
							description: "等排在前面的整理跑完再试。",
							id: "rejudge-busy",
							title: "已有整理在排队，这次重新判定没有加入",
						},
			);
	} catch {
		toast.error({
			description: "请稍后再试。",
			title: "没能发起重新判定",
		});
	}
}

/** 把一个范围退回重新判定。一项直接发；整批的先问一句。 */
export function rejudge(scope: Rejudge) {
	if (scope.scope === "term") return void send(scope);
	confirmModal({
		...WHOLE[scope.scope],
		okText: "重新判定",
		onOk: () => send(scope),
	});
}
