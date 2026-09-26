import { CheckIcon, ChevronDown, Ellipsis } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
	type DropdownItem,
	DropdownMenuHeader,
	DropdownMenuItemContent,
	DropdownMenuItemDesc,
	DropdownMenuItemIcon,
	DropdownMenuItemLabel,
	DropdownMenuItemLabelGroup,
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItemIndicator,
	DropdownMenuRadioItemPrimitive,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { Icon } from "#/components/ui/icon";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { QueryChips } from "#/routes/s/$turnId/-components/query-chips";
import { type Condition, MODES, type Mode } from "#/search/condition";
import { MODE_NAME } from "#/search/condition-label";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { RECOMMEND } from "../../samples/conditions";

/** 拼好的一个菜单：触发器，弹层里放 children。 */
function Menu({
	children,
	trigger,
}: {
	children: ReactNode;
	trigger: ReactElement;
}) {
	return (
		<DropdownMenuRoot>
			<DropdownMenuTrigger>{trigger}</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuPositioner>
					<DropdownMenuPopup>{children}</DropdownMenuPopup>
				</DropdownMenuPositioner>
			</DropdownMenuPortal>
		</DropdownMenuRoot>
	);
}

/** 强度的单选项：左端图标位里是勾；`hint` 给了就在名字下面加一行说明。 */
function ModeItems({
	hint,
	mode,
	onModeChange,
}: {
	hint?: (mode: Mode) => string;
	mode: Mode;
	onModeChange: (mode: Mode) => void;
}) {
	return (
		<DropdownMenuRadioGroup
			onValueChange={(next) => onModeChange(next as Mode)}
			value={mode}
		>
			{MODES.map((value) => (
				<DropdownMenuRadioItemPrimitive
					key={value}
					label={MODE_NAME[value]}
					value={value}
				>
					<DropdownMenuItemContent>
						<DropdownMenuItemIcon>
							<DropdownMenuRadioItemIndicator>
								<Icon icon={CheckIcon} />
							</DropdownMenuRadioItemIndicator>
						</DropdownMenuItemIcon>
						<DropdownMenuItemLabelGroup>
							<DropdownMenuItemLabel>{MODE_NAME[value]}</DropdownMenuItemLabel>
							{hint && (
								<DropdownMenuItemDesc>{hint(value)}</DropdownMenuItemDesc>
							)}
						</DropdownMenuItemLabelGroup>
					</DropdownMenuItemContent>
				</DropdownMenuRadioItemPrimitive>
			))}
		</DropdownMenuRadioGroup>
	);
}

function Playground() {
	const [radio, setRadio] = useState(true);
	const [header, setHeader] = useState(false);
	const [desc, setDesc] = useState(true);
	const [group, setGroup] = useState(true);
	const [mode, setMode] = useState<Mode>("must");
	const [on, setOn] = useState(true);
	const [picked, setPicked] = useState<string | null>(null);
	const part = (label: string) => ({
		key: label,
		label,
		onClick: () => setPicked(label),
	});
	// 第一项总是分隔线；不带单选项时去掉它，菜单不以分隔线开头。
	const items: DropdownItem[] = [
		...(group
			? [
					{ type: "divider" as const },
					{
						children: [part("去掉「Java」"), part("去掉「Go」")],
						label: "任一满足即可",
						type: "group" as const,
					},
				]
			: []),
		{ type: "divider" },
		{
			checked: on,
			key: "on",
			label: "启用",
			onCheckedChange: setOn,
			type: "switch",
		},
		{
			danger: true,
			key: "delete",
			label: "删除条件",
			onClick: () => setPicked("删除条件"),
		},
	];
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={radio} onChange={setRadio}>
						单选项
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={desc} disabled={!radio} onChange={setDesc}>
						说明行
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={header} onChange={setHeader}>
						说明栏
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={group} onChange={setGroup}>
						分组
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<>
						<span>强度 {MODE_NAME[mode]}</span>
						<span>{on ? "已启用" : "已停用"}</span>
						<span>上一次点的是 {picked ?? "（还没有）"}</span>
					</>
				}
			>
				<Menu
					trigger={
						<Button icon={ChevronDown} iconPosition="end" size="small">
							Java 或 Go
						</Button>
					}
				>
					{header && (
						<DropdownMenuHeader className="max-w-64 text-fg-secondary text-xs">
							说明栏在菜单最上面，写这个菜单作用的对象现在是什么状态。
						</DropdownMenuHeader>
					)}
					{radio && (
						<ModeItems
							hint={
								desc
									? (value) => `选「${MODE_NAME[value]}」时的一行说明`
									: undefined
							}
							mode={mode}
							onModeChange={setMode}
						/>
					)}
					{renderDropdownMenuItems(radio ? items : items.slice(1), {
						reserveIconSpace: radio,
					})}
				</Menu>
			</Stage>
		</div>
	);
}

/** 项的类型表的一行：类型名、写法、只有这一种项的菜单。 */
function ItemRow({
	children,
	code,
	name,
}: {
	children: ReactNode;
	code: string;
	name: string;
}) {
	return (
		<TableRow>
			<TableCell className="font-mono text-xs">{name}</TableCell>
			<TableCell className="font-mono text-fg-secondary text-xs">
				{code}
			</TableCell>
			<TableCell>
				<Menu
					trigger={
						<Button icon={ChevronDown} iconPosition="end" size="small">
							打开菜单
						</Button>
					}
				>
					{children}
				</Menu>
			</TableCell>
		</TableRow>
	);
}

/** 开关项一行：开关状态存在这一行里。 */
function SwitchRow() {
	const [on, setOn] = useState(true);
	return (
		<ItemRow code={`{ type: "switch", checked }`} name="switch">
			{renderDropdownMenuItems([
				{
					checked: on,
					key: "on",
					label: "启用",
					onCheckedChange: setOn,
					type: "switch",
				},
			])}
		</ItemRow>
	);
}

/** 单选项一行：选中的强度存在这一行里。 */
function RadioRow() {
	const [mode, setMode] = useState<Mode>("boost");
	return (
		<ItemRow code="DropdownMenuRadioGroup" name="radio">
			<ModeItems mode={mode} onModeChange={setMode} />
		</ItemRow>
	);
}

function ItemTypes() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>项的类型</TableHead>
						<TableHead>写法</TableHead>
						<TableHead>示例</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<ItemRow code="{ key, label, onClick }" name="item">
						{renderDropdownMenuItems([
							{ key: "copy", label: "复制搜索条件" },
							{ key: "export", label: "导出名单" },
						])}
					</ItemRow>
					<ItemRow code="{ danger: true }" name="item · danger">
						{renderDropdownMenuItems([
							{ key: "copy", label: "复制搜索条件" },
							{ danger: true, key: "delete", label: "删除条件" },
						])}
					</ItemRow>
					<ItemRow code={`{ type: "divider" }`} name="divider">
						{renderDropdownMenuItems([
							{ key: "copy", label: "复制搜索条件" },
							{ type: "divider" },
							{ danger: true, key: "delete", label: "删除条件" },
						])}
					</ItemRow>
					<ItemRow code={`{ type: "group", label, children }`} name="group">
						{renderDropdownMenuItems([
							{
								children: [
									{ key: "java", label: "去掉「Java」" },
									{ key: "go", label: "去掉「Go」" },
								],
								label: "任一满足即可",
								type: "group",
							},
						])}
					</ItemRow>
					<SwitchRow />
					<RadioRow />
				</TableBody>
			</Table>
		</Block>
	);
}

/** 产品里的搜索条件菜单：强度单选带说明行，停用时有说明栏，还有启用开关和删除。 */
function ConditionMenu() {
	const [conditions, setConditions] = useState<Condition[]>([
		{ ...RECOMMEND, off: "user" },
	]);
	return <QueryChips conditions={conditions} onChange={setConditions} />;
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="几选一的强度用单选项；有开关状态的选项用开关项，不用两句交替的文案表示开和关。"
				title="搜索条件"
			>
				<ConditionMenu />
			</Example>
			<Example
				description="收起的次要动作放进菜单，危险项放最后并用分隔线隔开。"
				title="更多操作"
			>
				<Menu trigger={<ActionIcon aria-label="更多操作" icon={Ellipsis} />}>
					{renderDropdownMenuItems([
						{ key: "copy", label: "复制搜索条件" },
						{ key: "export", label: "导出名单" },
						{ type: "divider" },
						{ danger: true, key: "delete", label: "删除这次搜索" },
					])}
				</Menu>
			</Example>
		</ExampleGrid>
	);
}

/** 下拉菜单页：试用、项的类型、使用场景。 */
export function DropdownMenuPage() {
	return (
		<DocPage
			facts={["单选项", "开关项", "可带说明栏"]}
			rules={{
				notes: [
					'菜单开关用开关项（type: "switch"），不能用两句交替的文案代替状态。',
					"几选一的项用 DropdownMenuRadioGroup，和其余项同在一个菜单时给 renderDropdownMenuItems 传 reserveIconSpace，让文字对齐。",
					"危险项用 danger，放在最后并用 divider 隔开。",
					"用原子件拼：Root › Trigger + Portal › Positioner › Popup；显示标签、键盘和触控行为要人工检查。",
					"触发器是单个按钮组件，属性合进它本身，不另包一层。",
				],
				usage: `<DropdownMenuRoot>\n  <DropdownMenuTrigger>\n    <Button>名单操作</Button>\n  </DropdownMenuTrigger>\n  <DropdownMenuPortal>\n    <DropdownMenuPositioner>\n      <DropdownMenuPopup>\n        {renderDropdownMenuItems([\n          { key: "export", label: "导出名单", onClick },\n          { checked, key: "on", label: "启用", onCheckedChange, type: "switch" },\n        ])}\n      </DropdownMenuPopup>\n    </DropdownMenuPositioner>\n  </DropdownMenuPortal>\n</DropdownMenuRoot>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用下拉菜单" },
				{ children: <ItemTypes />, id: "items", title: "项的类型" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
