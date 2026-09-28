import { Plus } from "lucide-react";
import { SuggestionChips } from "#/components/ui/suggestion-chips";
import { DocPage } from "../../kit/page";
import { Stage } from "../../kit/stage";

const ITEMS = [
	"把「大厂」改为：在字节、阿里、腾讯待过",
	"把「懂业务」改为：做过推荐排序（加分）",
	"把「沟通好」改为：带过 3 人以上的团队，并且在跨部门项目里担任负责人（加分）",
].map((label) => ({ key: label, label, onClick: () => {} }));

function Playground() {
	return (
		<Stage
			footer={
				<>
					<span>一枚一行，最宽 460px</span>
					<span>逐枚浮上，每枚晚 60ms</span>
				</>
			}
		>
			<div className="w-100">
				<SuggestionChips icon={Plus} items={ITEMS} label="可以改为" />
			</div>
		</Stage>
	);
}

export function SuggestionChipsPage() {
	return (
		<DocPage
			facts={["一枚一行", "放不下省略", "悬停图标换主色"]}
			rules={{
				notes: [
					"挂在一轮回复下面、点一下就能办的建议用 SuggestionChips，一枚一行。",
					"放不下的整句省略，悬停提示整句；不折行。",
				],
				usage: `<SuggestionChips icon={Plus} items={offers} label="可以改为" />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "替代条件" },
			]}
		/>
	);
}
