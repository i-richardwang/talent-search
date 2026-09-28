import { Popover } from "#/components/ui/popover";
import { ProgressTag } from "#/components/ui/progress-tag";
import { DocPage } from "../../kit/page";
import { Stage } from "../../kit/stage";

function Playground() {
	return (
		<Stage
			footer={
				<>
					<span>24px 高，16px 圆环、环宽 3px</span>
					<span>点开看每一项</span>
				</>
			}
		>
			<div className="flex flex-wrap items-center gap-3">
				<ProgressTag total={3} value={0} />
				<ProgressTag total={3} value={1} />
				<ProgressTag total={5} value={3} />
				<Popover
					content={<span className="text-sm">每一项的明细放在这里。</span>}
					placement="bottomRight"
					trigger="click"
				>
					<ProgressTag total={4} value={4} />
				</Popover>
			</div>
		</Stage>
	);
}

export function ProgressTagPage() {
	return (
		<DocPage
			facts={["圆环加几/几", "点开看依据", "按钮"]}
			rules={{
				notes: [
					"名单一行行尾的 ProgressTag 写这个人几条条件里命中了几条，点开是逐条的依据。",
					"圆环只画比例；数字写在右边，读的是数字。",
				],
				usage: `<Popover content={<ClaimEvidence lines={lines} />} trigger="click">
  <ProgressTag total={lines.length} value={hit} />
</Popover>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "几种样子" },
			]}
		/>
	);
}
