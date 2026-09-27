import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AutoComplete } from "#/components/ui/auto-complete";
import { Checkbox } from "#/components/ui/checkbox";
import { Form } from "#/components/ui/form";
import { Icon } from "#/components/ui/icon";
import { Tag } from "#/components/ui/tag";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 合成的技能词表，每个词带人数。 */
const SKILLS: [term: string, people: number][] = [
	["支付风控", 128],
	["风控策略", 64],
	["规则引擎", 41],
	["推荐系统", 212],
	["搜索排序", 97],
	["数据仓库", 185],
	["实时计算", 73],
	["分布式存储", 58],
	["前端工程化", 144],
	["团队管理", 301],
];

/** 一条建议：左边是词，右边是库里有多少人。 */
const option = (term: string, people: number) => ({
	label: (
		<span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
			<span className="min-w-0 truncate">{term}</span>
			<span className="shrink-0 text-fg-secondary text-xs">{people} 人</span>
		</span>
	),
	value: term,
});

const OPTIONS = SKILLS.map(([term, people]) => option(term, people));

function Playground() {
	const [pending, setPending] = useState(false);
	const [value, setValue] = useState("");
	const [reason, setReason] = useState<string | null>(null);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={pending} onChange={setPending}>
						等待建议
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span>框里 {value ? `「${value}」` : "空"}</span>
						<span className="font-mono">reason {reason ?? "—"}</span>
					</>
				}
			>
				<Form className="w-full max-w-xs" layout="vertical">
					<Form.Field label="经历或技能">
						<AutoComplete
							onChange={(text, details) => {
								setValue(text);
								setReason(details.reason);
							}}
							options={OPTIONS}
							placeholder="输入关键词，比如风控"
							suffix={
								pending ? <Icon icon={Loader2} size="small" spin /> : undefined
							}
							value={value}
						/>
					</Form.Field>
				</Form>
			</Stage>
		</div>
	);
}

/** 选中一项就加成一枚标签并清空框；敲字只改框里的字。 */
function TermPicker() {
	const [typed, setTyped] = useState("");
	const [terms, setTerms] = useState<string[]>(["支付风控"]);
	return (
		<Form className="w-full" layout="vertical">
			<Form.Field label="经历或技能">
				<div className="flex flex-col gap-2">
					<AutoComplete
						onChange={(text, details) => {
							if (details.reason === "item-press") {
								if (!terms.includes(text)) setTerms([...terms, text]);
								setTyped("");
							} else setTyped(text);
						}}
						options={OPTIONS.filter((one) => !terms.includes(one.value))}
						placeholder="输入关键词"
						value={typed}
					/>
					<div className="flex flex-wrap gap-1">
						{terms.map((term) => (
							<Tag
								closable
								key={term}
								onClose={() => setTerms(terms.filter((one) => one !== term))}
							>
								{term}
							</Tag>
						))}
					</div>
				</div>
			</Form.Field>
		</Form>
	);
}

/** 服务端给建议：关掉本地过滤，敲字后等一会儿换一批，等待中框尾转圈。 */
function ServerSuggestions() {
	const [typed, setTyped] = useState("");
	const [found, setFound] = useState(OPTIONS);
	const [pending, setPending] = useState(false);
	useEffect(() => {
		setPending(true);
		const timer = window.setTimeout(() => {
			setFound(OPTIONS.filter((one) => one.value.includes(typed.trim())));
			setPending(false);
		}, 600);
		return () => window.clearTimeout(timer);
	}, [typed]);
	return (
		<Form className="w-full" layout="vertical">
			<Form.Field label="经历或技能">
				<AutoComplete
					filter={null}
					onChange={setTyped}
					options={found}
					placeholder="输入关键词"
					suffix={
						pending ? <Icon icon={Loader2} size="small" spin /> : undefined
					}
					value={typed}
				/>
			</Form.Field>
		</Form>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="选中一项当成「添加」：按 details.reason 分辨是选中还是敲字，选中后加成标签并清空输入框。"
				title="从词表添加关键词"
			>
				<TermPicker />
			</Example>
			<Example
				description="建议由服务端按敲的字给出时传 filter={null}，等待中在 suffix 放旋转的加载图标。"
				title="服务端建议"
			>
				<ServerSuggestions />
			</Example>
		</ExampleGrid>
	);
}

/** 自动补全：输入框外壳与中号 Input 相同，敲字时弹出词表里的建议。 */
export function AutoCompletePage() {
	return (
		<DocPage
			facts={["可带后缀"]}
			rules={{
				notes: [
					"建议取自语料的词表，框里的字仍是用户自己写的，选中只是把那一项填进去。",
					"要把选中当成动作（比如加成标签）时，看 onChange 第二个参数的 reason 是不是 item-press。",
					"服务端给建议时传 filter={null} 关掉本地过滤，等待中在 suffix 放旋转的加载图标。",
					"输入框的名字来自外面带标签的 Form.Field；外面没有标签时写 aria-label。宽度属于外层布局。",
					'嵌在输入托盘的一行里用 variant="borderless"，框和底交给托盘。',
				],
				usage: `<AutoComplete\n  onChange={(text, details) => …}\n  options={[{ label: "支付风控", value: "支付风控" }]}\n  placeholder="输入关键词"\n  value={typed}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用自动补全" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
