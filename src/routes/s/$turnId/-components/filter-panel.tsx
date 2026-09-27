import { XIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import {
	AccordionHeader,
	AccordionItem,
	AccordionPanel,
	AccordionRoot,
	AccordionTrigger,
} from "#/components/ui/accordion";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox, CheckboxGroup } from "#/components/ui/checkbox";
import { Center } from "#/components/ui/flex";
import { Icon } from "#/components/ui/icon";
import { Radio, RadioGroup } from "#/components/ui/radio";
import { Text } from "#/components/ui/text";
import { cn } from "#/lib/utils";
import {
	activeCount,
	type FilterField,
	type TextFilter,
} from "../-lib/filters";
import { CLEARED_FILTERS, type View } from "../-lib/view-params";

const VISIBLE = 5;

/**
 * 筛选：搜索结果页左侧导航栏里的正文（`workbench-nav.tsx`）。每一维一组，组名一行
 * 可以收起，组名后面是这一维选了几项；选项后面一直写着选了之后还剩几个人，不用点开
 * 就知道能筛什么。
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
	const count = activeCount(fields, textFilters);
	// 记收起的组而不是展开的组：换一次查询多出来的维默认展开
	const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
	const shown = fields.filter((f) => f.options.length > 0);
	const keys = [...textFilters.map((t) => t.key), ...shown.map((f) => f.key)];

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2 ps-2">
				<Text size="xs" type="secondary" weight="medium">
					筛选
				</Text>
				<Button
					className={cn(count === 0 && "invisible")}
					onClick={() => onChange(CLEARED_FILTERS)}
					size="small"
					type="link"
				>
					清除 {count} 项
				</Button>
			</div>
			<AccordionRoot
				className="gap-2"
				indicatorPlacement="inline"
				onValueChange={(open) =>
					setClosed(new Set(keys.filter((k) => !open.includes(k))))
				}
				value={keys.filter((k) => !closed.has(k))}
			>
				{textFilters.map((t) => (
					<Group count={1} key={t.key} title={t.title} value={t.key}>
						<Button
							block
							className="justify-start"
							onClick={() => onChange(t.clear)}
							size="small"
							title={`取消「${t.title} ${t.value}」`}
							type="fill"
						>
							<Text className="min-w-0 flex-1 text-start" ellipsis>
								{t.value}
							</Text>
							<Icon
								className="shrink-0 text-fg-secondary"
								icon={XIcon}
								size="small"
							/>
						</Button>
					</Group>
				))}
				{shown.map((field) => (
					<Group
						count={field.values.length}
						key={field.key}
						title={field.title}
						value={field.key}
					>
						<FilterFacet field={field} onChange={onChange} />
					</Group>
				))}
			</AccordionRoot>
		</div>
	);
}

/** 一组：组名 12px 次要色，后面跟选了几项，三角紧跟在后面；点组名收起或展开。 */
function Group({
	value,
	title,
	count,
	children,
}: {
	value: string;
	title: string;
	/** 这一组选中了几项；0 时不写。 */
	count: number;
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
							<Text className="tabular-nums" size="xs" type="secondary">
								{count}
							</Text>
						)}
					</span>
				</AccordionTrigger>
			</AccordionHeader>
			<AccordionPanel contentClassName="flex flex-col gap-px pt-px">
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
				<Button
					className="self-start text-fg-secondary"
					onClick={() => setAll(!all)}
					size="small"
					type="text"
				>
					{all ? "收起" : `更多 ${rest.length} 项`}
				</Button>
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
 * 一个选项一行：36px 高，行内左右 4px；选择框在 28px 见方的格里，和导航项的图标格
 * 同宽；名字截断时悬停看全；人数在行尾。选中的一行字换成正文色。
 */
function Option({
	children,
	disabled,
	multi,
	n,
	value,
}: {
	children: ReactNode;
	disabled?: boolean;
	multi: boolean;
	n: number | null;
	value: string;
}) {
	return (
		<Block
			align="center"
			as="label"
			className={cn(
				"text-fg-secondary has-data-checked:text-fg",
				disabled && "cursor-not-allowed opacity-50",
			)}
			clickable={!disabled}
			gap={8}
			height={36}
			horizontal
			paddingInline={4}
			variant="borderless"
		>
			<Center flex="none" height={28} width={28}>
				{multi ? (
					<Checkbox disabled={disabled} value={value} />
				) : (
					<Radio disabled={disabled} value={value} />
				)}
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
