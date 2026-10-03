import { Progress } from "#/components/ui/progress";
import { integer } from "#/lib/format";
import { DocPage } from "../../kit/page";
import { Stage } from "../../kit/stage";

const SAMPLES = [
	{ done: 0, total: 31_279 },
	{ done: 5_361, total: 31_279 },
	{ done: 31_279, total: 31_279 },
];

function Playground() {
	return (
		<Stage
			footer={
				<>
					<span>8px 高，两头圆</span>
					<span>轨道浅填充，条是主色</span>
				</>
			}
		>
			<div className="flex w-full max-w-md flex-col gap-4">
				{SAMPLES.map(({ done, total }) => (
					<div className="flex flex-col gap-2.5" key={done}>
						<span className="text-fg-tertiary text-xs tabular-nums">
							{integer(done)} / {integer(total)}
						</span>
						<Progress aria-label="已解析" max={total} value={done} />
					</div>
				))}
			</div>
		</Stage>
	);
}

export function ProgressPage() {
	return (
		<DocPage
			facts={["一根条画比例", "数写在旁边"]}
			rules={{
				notes: [
					"做到哪了用 Progress：上面一行写「几 / 几」，右边百分数，条在下面。",
					"条只画比例，读的是写出来的数；aria-label 说这根条量的是什么。",
				],
				usage: `<Progress aria-label="段经历已解析" max={total} value={done} />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "几种样子" },
			]}
		/>
	);
}
