import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Hotkey } from "#/components/ui/hotkey";
import { Input } from "#/components/ui/input";
import { Segmented } from "#/components/ui/segmented";
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

type Variant = "filled" | "outlined" | "borderless";

/** 苹果设备上画成符号的键名；方向键与空格两边都画成图标；其余键名首字母大写原样显示。 */
const SYMBOL_KEYS = [
	"mod",
	"ctrl",
	"meta",
	"alt",
	"shift",
	"enter",
	"backspace",
	"tab",
	"up",
	"down",
	"left",
	"right",
	"space",
];

/** 键名表的行：写法与说明。 */
const KEY_ROWS: [keys: string, what: string][] = [
	["mod+k", "mod：苹果设备上是 ⌘，其他设备是 Ctrl"],
	["shift+mod+z", "修饰键排到前面，按 Ctrl、⌘、Alt、Shift 的先后"],
	["alt+enter", "⌥ 与回车"],
	["ctrl+tab", "⌃ 与 Tab"],
	["backspace", "退格"],
	["up+down", "两个方向键"],
	["space", "空格"],
	["esc", "没有符号的键名"],
];

/** 外观表的行：写法、说明。 */
const VARIANTS: [variant: Variant, compact: boolean, what: string][] = [
	["filled", false, "默认：每个键一个浅灰底的键帽"],
	["filled", true, "compact：几个键收进一个键帽，跟在提示文字后面"],
	["outlined", false, "容器底加一圈描边，放在浅灰的面上"],
	["borderless", false, "不画底、颜色跟着那句话，夹在句子里"],
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
	const [variant, setVariant] = useState<Variant>("filled");
	const [compact, setCompact] = useState(false);
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
				<Control label="外观">
					<Segmented<Variant>
						onChange={setVariant}
						options={[
							{ label: "filled", value: "filled" },
							{ label: "outlined", value: "outlined" },
							{ label: "borderless", value: "borderless" },
						]}
						value={variant}
					/>
				</Control>
				<Control>
					<Checkbox checked={compact} onChange={setCompact}>
						compact
					</Checkbox>
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
					{keys.trim() && (
						<Hotkey compact={compact} keys={keys} variant={variant} />
					)}
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

function Variants() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>写法</TableHead>
						<TableHead>说明</TableHead>
						<TableHead>键帽</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{VARIANTS.map(([variant, compact, what]) => (
						<TableRow key={`${variant}-${compact}`}>
							<TableCell className="font-mono text-xs">
								{variant}
								{compact && " · compact"}
							</TableCell>
							<TableCell className="text-fg-secondary">{what}</TableCell>
							<TableCell>
								<Hotkey compact={compact} keys="mod+enter" variant={variant} />
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
				description="输入托盘的占位里说明怎么换行：键夹在句子里，不画底，颜色跟着占位。"
				title="占位里的键"
			>
				<span className="inline-flex items-center text-fg-tertiary text-sm">
					按<Hotkey keys="shift+enter" variant="borderless" />
					换行
				</span>
			</Example>
			<Example
				description="搜索框右端的提示：几个键挤在一个键帽里（compact），占的宽度小。"
				title="搜索框的快捷键"
			>
				<span className="flex items-center gap-4 text-fg-secondary text-xs">
					<Hotkey compact keys="mod+k" />
					<Hotkey compact keys="mod+shift+f" />
				</span>
			</Example>
		</ExampleGrid>
	);
}

/** 快捷键：每个键一个键帽或收进一个，修饰键按设备换写法。 */
export function HotkeyPage() {
	return (
		<DocPage
			facts={[
				`${VARIANTS.length} 种外观`,
				"按设备换写法",
				`${SYMBOL_KEYS.length} 个键画成符号`,
			]}
			rules={{
				notes: [
					"keys 写键名并用 + 连接；修饰键排到前面，其余键按写的先后。mod 在苹果设备上画成 ⌘，其他设备写 Ctrl。",
					`画成符号的键名是 ${SYMBOL_KEYS.join("、")}；修饰键、回车、退格、Tab 只在苹果设备上画成符号，其他设备写名字。其余键名首字母大写原样显示。`,
					"单独摆着的说明用 filled；提示里跟在文字后面的用 compact（Tooltip 的 hotkey 自己会这样画）；夹在一句话里的用 borderless。",
					"快捷键说明只在有指针的设备上显示，触屏上没有键盘。",
					"放在输入框这类窄处时给 compact，几个键放进同一个键帽。",
				],
				usage: `<Hotkey keys="mod+k" />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用快捷键" },
				{ children: <Variants />, id: "appearance", title: "外观" },
				{ children: <KeyNames />, id: "keys", title: "键名" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
