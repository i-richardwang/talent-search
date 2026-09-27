import { useRouterState } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { KeywordBar } from "#/components/keyword-bar";
import { QueryBar } from "#/components/query-bar";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { HomeScreen } from "#/routes/-components/home-screen";
import { COMMIT_FAILED } from "#/routes/-lib/commit";
import type { Condition } from "#/search/condition";
import { inSentence } from "#/search/condition-label";
import { keywordsOf, NO_KEYWORDS } from "#/search/keywords";
import type { QueryInput } from "#/search/spec";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { Routed } from "../../routed";
import { KEYWORD_SPEC } from "../../samples/conditions";

/** 关键词搜索结果页框里填回的词：经历「推荐系统」、公司「某甲科技」、两年以上。 */
const KEYWORDS = keywordsOf(KEYWORD_SPEC.conditions) ?? NO_KEYWORDS;

/** 一次提交说成一句话，写在展示台的读数条上。 */
function describe(input: QueryInput) {
	return input.kind === "sentence"
		? `提交了需求「${input.text}」`
		: `提交了搜索条件：${inSentence(input.spec.conditions)}`;
}

/** 产品的首页正文；切换读内存 router 地址上的 `mode`，和产品里一样由地址决定。 */
function Home({
	failing,
	onQuery,
	understanding,
}: {
	failing: boolean;
	onQuery: (input: QueryInput) => boolean;
	understanding: boolean;
}) {
	const search = useRouterState({ select: (s) => s.location.search }) as {
		mode?: string;
	};
	return (
		<HomeScreen
			asked={search.mode === "keyword" ? "keyword" : undefined}
			error={failing ? COMMIT_FAILED : null}
			onQuery={onQuery}
			understanding={understanding}
		/>
	);
}

function Playground() {
	const [understanding, setUnderstanding] = useState(true);
	const [failing, setFailing] = useState(false);
	const [last, setLast] = useState<string | null>(null);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={understanding} onChange={setUnderstanding}>
						开启 AI 搜索
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={failing} onChange={setFailing}>
						提交失败
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				className="items-stretch p-0 pb-10"
				footer={
					<span>{last ?? "点一条示例填进输入框，或写一句需求后回车"}</span>
				}
			>
				<Routed url="/">
					<Home
						failing={failing}
						key={String(understanding)}
						onQuery={(input) => {
							setLast(
								failing
									? `${describe(input)}，没有提交成功，原话留在框里`
									: describe(input),
							);
							return !failing;
						}}
						understanding={understanding}
					/>
				</Routed>
			</Stage>
		</div>
	);
}

/** 流程的每一步：用户做什么、界面怎么回应。 */
const STEPS: [step: string, does: string, answers: string][] = [
	[
		"选方式",
		"在「AI 搜索」和「关键词搜索」之间切换",
		"地址上的 mode 换掉，回到首页从头开一次新的搜索，不带条件过去",
	],
	[
		"写需求",
		"AI 搜索写一句话；关键词搜索一个框填一维",
		"AI 搜索的输入框随内容长高；关键词框下拉给出人才库里真有的写法",
	],
	[
		"用示例起头",
		"点首页输入框下的一条示例",
		"只填进输入框、光标落在末尾，不直接搜",
	],
	[
		"提交",
		"回车或点发送；关键词搜索点「搜索」",
		"先落一条搜索记录并进入名单页；AI 在名单页里理解需求",
	],
	[
		"提交失败",
		"网络断开或保存失败",
		"输入框下出现一块 Alert，原话留在框里，可以直接再提交",
	],
	[
		"接着补充",
		"在名单页右栏的输入框里再写一句",
		"作用在正在看的那次搜索条件上；上一句还没理解完时能写不能发",
	],
];

function Flow() {
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
					{STEPS.map(([step, does, answers]) => (
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

/** 「技术口碑好」搜不了时附带的替代条件：做过技术分享（加分）。 */
const TECH_TALKS: Condition = {
	about: "experience",
	mode: "boost",
	what: ["技术分享"],
};

/** 挂在托盘上沿的一片：名单页右栏里放的是搜不了的要求附带的替代条件。 */
function Tray() {
	return (
		<div className="flex items-center gap-2">
			<span className="min-w-0 flex-1">
				「技术口碑好」可改为：{inSentence([TECH_TALKS])}
			</span>
			<Button className="shrink-0" icon={PlusIcon} size="small" type="text">
				添加
			</Button>
		</div>
	);
}

/** 输入框的几种尺寸与状态，每格一个真的 `QueryBar` 或 `KeywordBar`。 */
function States() {
	const accept = () => true;
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>状态</TableHead>
						<TableHead>输入面</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell className="font-mono text-xs">middle</TableCell>
						<TableCell className="w-full">
							<QueryBar
								onQuery={accept}
								placeholder="补充或修改需求，例如：最好带过团队"
							/>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">large</TableCell>
						<TableCell className="w-full">
							<QueryBar
								onQuery={accept}
								placeholder="描述你要找的人，例如：做过推荐算法、带过团队"
								size="large"
							/>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">middle · tray</TableCell>
						<TableCell className="w-full">
							<QueryBar
								onQuery={accept}
								placeholder="补充或修改需求，例如：最好带过团队"
								tray={<Tray />}
							/>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">large · tray</TableCell>
						<TableCell className="w-full">
							<QueryBar
								onQuery={accept}
								placeholder="描述你要找的人，例如：做过推荐算法、带过团队"
								size="large"
								tray={<Tray />}
							/>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">waiting</TableCell>
						<TableCell className="w-full">
							<div className="flex flex-col gap-1.5">
								<QueryBar
									onQuery={accept}
									placeholder="补充或修改需求，例如：最好带过团队"
									waiting
								/>
								<span className="text-fg-secondary text-xs">
									上一句还在理解：能继续写，发送按不下去
								</span>
							</div>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">keyword</TableCell>
						<TableCell className="w-full">
							<KeywordBar onSearch={accept} />
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-mono text-xs">keyword · 已搜</TableCell>
						<TableCell className="w-full">
							<KeywordBar initial={KEYWORDS} onSearch={accept} />
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</Block>
	);
}

/** 过一会儿才交回结果的提交：发送按钮转圈，成功才清空。 */
function slow(ok: boolean, report: (text: string) => void) {
	return (input: QueryInput) =>
		new Promise<boolean>((done) =>
			window.setTimeout(() => {
				report(
					ok
						? `${describe(input)}，已清空输入框`
						: `${describe(input)}，没有提交成功`,
				);
				done(ok);
			}, 1200),
		);
}

function Usage() {
	const [sent, setSent] = useState<string | null>(null);
	const [lost, setLost] = useState<string | null>(null);
	const [keyword, setKeyword] = useState<string | null>(null);
	return (
		<ExampleGrid>
			<Example
				description="名单页右栏线程底下是同一个输入框：补充一句需求。提交要等保存完成，这段时间发送按钮转圈，成功后才清空。"
				title="补充下一句"
			>
				<div className="flex w-full flex-col gap-2">
					<QueryBar
						onQuery={slow(true, setSent)}
						placeholder="补充或修改需求，例如：最好带过团队"
					/>
					<span className="text-fg-secondary text-xs">
						{sent ?? "写一句后回车"}
					</span>
				</div>
			</Example>
			<Example
				description="提交没成功时原话不清空：用户刚写的需求不会丢，改一改或直接再发一次。"
				title="提交失败留住原话"
			>
				<div className="flex w-full flex-col gap-2">
					<QueryBar
						onQuery={slow(false, setLost)}
						placeholder="描述你要找的人，例如：做过推荐算法、带过团队"
					/>
					<span className="text-fg-secondary text-xs">
						{lost ?? "写一句后回车"}
					</span>
				</div>
			</Example>
			<Example
				description="关键词搜索的结果页把这次的词填回名单上方的框；没改动时「搜索」按不下去，改完再搜是一次新的搜索，浏览器后退就是撤销。"
				title="关键词结果页改词"
			>
				<div className="flex w-full flex-col gap-2">
					<KeywordBar
						initial={KEYWORDS}
						onSearch={(conditions) => {
							setKeyword(`搜索：${inSentence(conditions)}`);
							return true;
						}}
					/>
					<span className="text-fg-secondary text-xs">
						{keyword ?? "加一个词或改累计年限后点「搜索」"}
					</span>
				</div>
			</Example>
			<Example
				description="没开启 AI 搜索时首页没有切换，也没有写一句话的输入框，只有关键词搜索。"
				title="只有关键词搜索"
			>
				<div className="w-full">
					<KeywordBar onSearch={() => true} />
				</div>
			</Example>
		</ExampleGrid>
	);
}

/** 写需求：首页选一种搜索方式，用一句话或几个关键词说出要找什么样的人。 */
export function QueryInputPage() {
	return (
		<DocPage
			facts={[
				"AI 搜索与关键词搜索",
				`${STEPS.length} 个步骤`,
				"提交失败留住原话",
			]}
			rules={{
				notes: [
					"两种模式叫「AI 搜索」和「关键词搜索」；各是一条搜索记录，换方式是从头开一次新的搜索，不带条件过去。",
					"写一句话的输入框全站只有一个形状：首页写第一句用 large，名单页右栏补充下一句用 middle。",
					"托盘上沿的一片（tray）放作用在这句话之前、点一下就能办的事，例如添加替代条件。",
					"示例最多四条，点一下只填进输入框，不直接搜。",
					"提交先落记录并导航，理解在名单页进行；提交失败用 Alert 说，原话不清空。",
					"关键词搜索只放填词的维（经历或技能、公司或部门、学校、累计年限），有限取值的维只在筛选栏。",
					"没开启 AI 搜索时只有关键词搜索，不给写一句话的输入框。",
				],
				usage: `<HomeScreen\n  asked={mode}\n  error={error}\n  onQuery={commit}\n  understanding={understanding}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用首页" },
				{ children: <Flow />, id: "flow", title: "流程" },
				{ children: <States />, id: "appearance", title: "输入面的尺寸与状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
