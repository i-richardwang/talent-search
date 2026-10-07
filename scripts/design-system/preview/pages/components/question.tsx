import { useState } from "react";
import { Button } from "#/components/ui/button";
import { AnsweredQuestion, Question } from "#/components/ui/question";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

const OPTIONS = [
	{ current: true, key: "web", label: "只看网页前端" },
	{
		description: "人才库里写 iOS 或 Android 开发的还有四十多位",
		key: "app",
		label: "把 iOS 和 Android 也算上",
	},
	{
		description: "人才库里写小程序开发的有二十多位",
		key: "mini",
		label: "再算上小程序",
	},
];

const QUESTION = "前端有两种常见的意思，你要的是哪种？";

function Playground() {
	const [answer, setAnswer] = useState<string | null>(null);
	return (
		<Stage
			footer={
				<>
					<span>一项 10px × 12px 内边距，项间 4px；编号格 22px</span>
					<span>数字键由用到它的那一屏接</span>
				</>
			}
		>
			<div className="w-100">
				{answer ? (
					<div className="flex flex-col items-start gap-3">
						<AnsweredQuestion answer={answer} question={QUESTION} />
						<Button onClick={() => setAnswer(null)} size="small">
							重来
						</Button>
					</div>
				) : (
					<Question
						onChoose={(key) =>
							setAnswer(OPTIONS.find((o) => o.key === key)?.label ?? null)
						}
						options={OPTIONS}
						question={QUESTION}
					/>
				)}
			</div>
		</Stage>
	);
}

function States() {
	return (
		<ExampleGrid>
			<Example
				description="搜不了的要求也这样问：第一项是不管它、照现在的名单，下面是换成相近找法的那一种。"
				title="只有一种别的做法"
			>
				<Question
					onChoose={() => {}}
					options={[
						{ current: true, key: "keep", label: "先不管这两条" },
						{
							description: "简历里写过技术分享的有六十多位",
							key: "share",
							label: "做过技术分享的优先",
						},
					]}
					question="人才库里没有工作地点，简历里也看不出技术口碑，要不要先看做过技术分享的？"
				/>
			</Example>
			<Example
				description="问过之后收成两行：问话照常，答的是哪一项淡一档，不画边框和图标。"
				title="答过"
			>
				<AnsweredQuestion
					answer="把 iOS 和 Android 也算上"
					question={QUESTION}
				/>
			</Example>
			<Example
				description="接着说了别的话，没选哪一项：只留问话。"
				title="没答"
			>
				<AnsweredQuestion answer={null} question={QUESTION} />
			</Example>
		</ExampleGrid>
	);
}

/** 一问几选：AI 在回复里问 HR 的那一件事。 */
export function QuestionPage() {
	return (
		<DocPage
			facts={["一句问话", "带编号的几项", "点了就办"]}
			rules={{
				notes: [
					"回复里要对方拿主意时用 Question：一句问话，下面两三项，每项一个短标题和一行说明。",
					"现在用着的那一项铺底、标「当前」，不能点；其余每项是一个按钮，点了就办，没有另外的提交钮和跳过钮。",
					"onChoose 返回的 Promise 结束前，几项都不能再点。",
					"问过之后换成 AnsweredQuestion，问话照常，答案淡一档。",
				],
				usage: `<Question
  onChoose={(key) => revise(key)}
  options={[{ current: true, key: "web", label: "只看网页前端" }, …]}
  question="前端有两种常见的意思，你要的是哪种？"
/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用" },
				{ children: <States />, id: "states", title: "几种样子" },
			]}
		/>
	);
}
