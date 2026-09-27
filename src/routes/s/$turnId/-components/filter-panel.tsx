import { ChevronUpIcon, MoreHorizontalIcon, XIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import {
	AccordionAction,
	AccordionHeader,
	AccordionItem,
	AccordionPanel,
	AccordionRoot,
	AccordionTrigger,
} from "#/components/ui/accordion";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Checkbox, CheckboxGroup } from "#/components/ui/checkbox";
import { Center } from "#/components/ui/flex";
import { NavItem } from "#/components/ui/nav-item";
import { Radio, RadioGroup } from "#/components/ui/radio";
import { Text } from "#/components/ui/text";
import { cn } from "#/lib/utils";
import type { FilterField, TextFilter } from "../-lib/filters";
import type { View } from "../-lib/view-params";

const VISIBLE = 5;

/**
 * 筛选：搜索结果页左侧导航栏里的正文（`workbench-nav.tsx`）。每一维一组，组名一行
 * 可以收起，组名后面是这一维选了几项，行尾清掉这一维的钮在指针进入这一行时出现；
 * 选项后面一直写着选了之后还剩几个人，不用点开就知道能筛什么。
 *
 * 一维都数不出人、也没有生效的文本条件时整块不渲染：空着的一组就是它不该占位的证据。
 */
export function FilterPanel(props: FilterProps) {
	if (!hasAnything(props)) return null;
	return <FilterList {...props} />;
}

type FilterProps = {
	fields: FilterField[];
	textFilters: TextFilter[];
	onChange: (next: Partial<View>) => void;
};

function hasAnything({ fields, textFilters }: FilterProps) {
	return fields.some((f) => f.options.length > 0) || textFilters.length > 0;
}

function FilterList({ fields, textFilters, onChange }: FilterProps) {
	// 记收起的组而不是展开的组：换一次查询多出来的维默认展开
	const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
	const shown = fields.filter((f) => f.options.length > 0);
	const keys = [...textFilters.map((t) => t.key), ...shown.map((f) => f.key)];

	return (
		<AccordionRoot
			className="gap-2"
			indicatorPlacement="inline"
			onValueChange={(open) =>
				setClosed(new Set(keys.filter((k) => !open.includes(k))))
			}
			value={keys.filter((k) => !closed.has(k))}
		>
			{textFilters.map((t) => (
				<Group
					count={1}
					key={t.key}
					onClear={() => onChange(t.clear)}
					title={t.title}
					value={t.key}
				>
					<Option multi={null} n={null}>
						{t.value}
					</Option>
				</Group>
			))}
			{shown.map((field) => (
				<Group
					count={field.values.length}
					key={field.key}
					onClear={() => onChange(field.set([]))}
					title={field.title}
					value={field.key}
				>
					<FilterFacet field={field} onChange={onChange} />
				</Group>
			))}
		</AccordionRoot>
	);
}

/**
 * 一组：组名 12px 中粗次要色，后面跟选了几项（三级灰、等宽数字），三角紧跟在后面；
 * 点组名收起或展开。选了东西时行尾有一个清掉这一维的钮。
 */
function Group({
	value,
	title,
	count,
	onClear,
	children,
}: {
	value: string;
	title: string;
	/** 这一组选中了几项；0 时不写。 */
	count: number;
	onClear: () => void;
	children: ReactNode;
}) {
	return (
		<AccordionItem value={value}>
			<AccordionHeader>
				<AccordionTrigger className="ps-2 pe-1 py-1">
					<span className="flex min-w-0 items-center gap-1">
						<Text ellipsis size="xs" type="secondary" weight="medium">
							{title}
						</Text>
						{count > 0 && (
							<Text className="tabular-nums" size="xs" type="tertiary">
								{count}
							</Text>
						)}
					</span>
				</AccordionTrigger>
				{count > 0 && (
					<AccordionAction>
						<ActionIcon
							icon={XIcon}
							onClick={onClear}
							size="small"
							title={`清除「${title}」`}
						/>
					</AccordionAction>
				)}
			</AccordionHeader>
			<AccordionPanel contentClassName="flex flex-col gap-px">
				{children}
			</AccordionPanel>
		</AccordionItem>
	);
}

function FilterFacet({
	field,
	onChange,
}: {
	field: FilterField;
	onChange: (next: Partial<View>) => void;
}) {
	const [all, setAll] = useState(false);
	const titleId = useId();

	const head = collapse(field);
	const rest = field.options.filter((o) => !head.includes(o));

	const rows = (options: FilterField["options"]) =>
		options.map((o) => (
			<Option
				disabled={o.n === 0 && !field.values.includes(o.value)}
				key={o.value}
				multi={field.multi}
				n={o.n}
				value={o.value}
			>
				{o.label}
			</Option>
		));

	const list = (
		<>
			{rows(head)}
			{all && rows(rest)}
			{rest.length > 0 && (
				<NavItem
					icon={all ? ChevronUpIcon : MoreHorizontalIcon}
					iconSize="small"
					onClick={() => setAll(!all)}
					render={<button type="button" />}
				>
					{all ? "收起" : `更多 ${rest.length} 项`}
				</NavItem>
			)}
		</>
	);

	return (
		<>
			<span className="sr-only" id={titleId}>
				{field.title}
			</span>
			{field.multi ? (
				<CheckboxGroup
					aria-labelledby={titleId}
					className="flex w-full flex-col gap-px"
					onChange={(next) => onChange(field.set(next))}
					value={field.values}
				>
					{list}
				</CheckboxGroup>
			) : (
				<RadioGroup
					aria-labelledby={titleId}
					className="flex w-full flex-col gap-px"
					onChange={(next) => onChange(field.set(next ? [next] : []))}
					value={field.values[0] ?? ""}
				>
					<Option multi={false} n={null} value="">
						不限
					</Option>
					{list}
				</RadioGroup>
			)}
		</>
	);
}

/**
 * 一个选项一行，和导航项同一个排法：36px 高，行内左右 4px；选择框在 28px 见方的格里，
 * 和导航项的图标格同宽；名字截断时悬停看全；人数在行尾。选中的一行字换成正文色。
 * 文本条件（`multi` 为 null）没有候选，只有一行正文色的字，清掉它用组名行尾的钮。
 */
function Option({
	children,
	disabled,
	multi,
	n,
	value = "",
}: {
	children: ReactNode;
	disabled?: boolean;
	multi: boolean | null;
	n: number | null;
	value?: string;
}) {
	return (
		<Block
			align="center"
			as={multi === null ? "div" : "label"}
			className={cn(
				multi === null
					? "text-fg"
					: "text-fg-secondary has-data-checked:text-fg",
				disabled && "cursor-not-allowed opacity-50",
			)}
			clickable={multi !== null && !disabled}
			gap={8}
			height={36}
			horizontal
			paddingInline={4}
			variant="borderless"
		>
			<Center flex="none" height={28} width={28}>
				{multi === true && <Checkbox disabled={disabled} value={value} />}
				{multi === false && <Radio disabled={disabled} value={value} />}
			</Center>
			<Text className="min-w-0 flex-1" ellipsis={{ tooltip: true }}>
				{children}
			</Text>
			{n !== null && (
				<Text className="shrink-0 pe-1 tabular-nums" size="xs" type="tertiary">
					{n}
				</Text>
			)}
		</Block>
	);
}

// 选中的项总在展开的那几项里，才能随时取消。
function collapse({ options, values }: FilterField) {
	const head = options.slice(0, VISIBLE);
	const buried = options.filter(
		(o) => values.includes(o.value) && !head.includes(o),
	);
	if (buried.length === 0) return head;
	return [...buried, ...head.slice(0, Math.max(VISIBLE - buried.length, 0))];
}
