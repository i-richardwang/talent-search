import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Hotkey } from "#/components/ui/hotkey";
import { Input } from "#/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { useMeasured } from "../../kit/readings";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 画成符号的键名；其余键名首字母大写原样显示。 */
const SYMBOL_KEYS = ["mod", "enter", "up", "down", "space"];

/** 键名表的行：写法与说明。 */
const KEY_ROWS: [keys: string, what: string][] = [
	["mod+k", "修饰键加字母"],
	["mod+enter", "修饰键加回车"],
	["up+down", "两个方向键"],
	["space", "空格"],
	["esc", "没有符号的键名"],
];

/** 名单页底部那一排快捷键说明。 */
const LIST_KEYS: [keys: string, what: string][] = [
	["/", "修改需求"],
	["up+down", "切换候选人"],
	["esc", "关闭详情"],
	["space", "选择或取消"],
];

function Playground() {
	const [keys, setKeys] = useState("mod+k");
	const count = keys.split("+").filter(Boolean).length;
	const { reading: keycaps, ref } = useMeasured(
		(root) => root.querySelectorAll("kbd").length,
	);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control
					className="grow"
					htmlFor="playground-hotkey-keys"
					label="按键（用 + 连接）"
				>
					<Input
						className="font-mono"
						id="playground-hotkey-keys"
						onChange={(event) => setKeys(event.target.value)}
						value={keys}
						variant="filled"
					/>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span>{count} 个键</span>
						<span>画出 {keycaps ?? 0} 个键帽</span>
					</>
				}
			>
				<div className="contents" ref={ref}>
					{keys.trim() && <Hotkey keys={keys} />}
				</div>
			</Stage>
		</div>
	);
}

function KeyNames() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>keys</TableHead>
						<TableHead>键帽</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{KEY_ROWS.map(([keys, what]) => (
						<TableRow key={keys}>
							<TableCell>
								<div className="flex flex-col gap-0.5">
									<span className="font-mono text-xs">{keys}</span>
									<span className="text-fg-tertiary text-xs">{what}</span>
								</div>
							</TableCell>
							<TableCell>
								<Hotkey keys={keys} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="名单页底部列出当前可用的键，每个键后面一句动作。"
				title="快捷键说明"
			>
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-fg-secondary text-xs">
					{LIST_KEYS.map(([keys, what]) => (
						<span className="flex items-center gap-1.5" key={keys}>
							<Hotkey keys={keys} />
							{what}
						</span>
					))}
				</div>
			</Example>
			<Example
				description="输入框旁边说明怎么提交需求，键帽后面一句动作。"
				title="提交方式"
			>
				<span className="flex items-center gap-1.5 text-fg-secondary text-xs">
					<Hotkey keys="mod+enter" />
					提交需求
				</span>
			</Example>
		</ExampleGrid>
	);
}

/** 快捷键：每个键一个键帽，mod 与回车按设备换写法。 */
export function HotkeyPage() {
	return (
		<DocPage
			facts={[
				"每键一个键帽",
				"按设备换写法",
				`${SYMBOL_KEYS.length} 个键画成符号`,
			]}
			rules={{
				notes: [
					"keys 写键名并用 + 连接，按写的先后显示；mod 在苹果设备上画成 ⌘，其他设备写 Ctrl。",
					`画成符号的键名是 ${SYMBOL_KEYS.join("、")}；其余键名首字母大写原样显示。`,
					"快捷键说明只在有指针的设备上显示，触屏上没有键盘。",
				],
				usage: `<Hotkey keys="mod+k" />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用快捷键" },
				{ children: <KeyNames />, id: "keys", title: "键名" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
