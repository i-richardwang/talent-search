import { XIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Checkbox, CheckboxGroup } from "#/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Icon } from "#/components/ui/icon";
import { Radio, RadioGroup } from "#/components/ui/radio";
import { cn } from "#/lib/utils";
import {
	activeCount,
	type FilterField,
	type TextFilter,
} from "../-lib/filters";
import { CLEARED_FILTERS, type View } from "../-lib/view-params";

const VISIBLE = 5;

/**
 * 筛选：搜索结果页左侧导航栏里的正文（`workbench-nav.tsx`）。每一维一组，选项后面一直
 * 写着选了之后还剩几个人，不用点开就知道能筛什么。
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

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-2 px-2">
				<span className="text-xs font-medium text-fg-secondary">筛选</span>
				<Button
					className={cn(count === 0 && "invisible")}
					onClick={() => onChange(CLEARED_FILTERS)}
					size="small"
					type="link"
				>
					清除 {count} 项
				</Button>
			</div>
			{textFilters.map((t) => (
				<section className="flex flex-col gap-0.5" key={t.key}>
					<h2 className="text-xs font-medium px-2 pb-1 text-fg-secondary">
						{t.title}
					</h2>
					<Button
						block
						className="justify-start"
						onClick={() => onChange(t.clear)}
						size="small"
						title={`取消「${t.title} ${t.value}」`}
						type="fill"
					>
						<span className="min-w-0 flex-1 truncate text-start">
							{t.value}
						</span>
						<Icon
							className="shrink-0 text-fg-secondary"
							icon={XIcon}
							size="small"
						/>
					</Button>
				</section>
			))}

			{fields.map((field) => (
				<FilterFacet field={field} key={field.key} onChange={onChange} />
			))}
		</div>
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
	const restId = useId();
	if (field.options.length === 0) return null;

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
			{rest.length > 0 && (
				<>
					<Collapsible id={restId} open={all}>
						{rows(rest)}
					</Collapsible>
					<CollapsibleTrigger
						className="w-full px-2 py-1 text-fg-secondary text-sm"
						onOpenChange={setAll}
						open={all}
						panelId={restId}
					>
						{all ? "收起" : `更多 ${rest.length} 项`}
					</CollapsibleTrigger>
				</>
			)}
		</>
	);

	return (
		<div className="flex min-w-0 flex-col gap-1">
			<div
				className="px-2 pb-1 font-medium text-fg-secondary text-xs"
				id={titleId}
			>
				{field.title}
			</div>
			{field.multi ? (
				<CheckboxGroup
					aria-labelledby={titleId}
					className="w-full"
					onChange={(next) => onChange(field.set(next))}
					value={field.values}
				>
					{list}
				</CheckboxGroup>
			) : (
				<RadioGroup
					aria-labelledby={titleId}
					className="w-full"
					onChange={(next) => onChange(field.set(next ? [next] : []))}
					value={field.values[0] ?? ""}
				>
					<Option multi={false} n={null} value="">
						不限
					</Option>
					{list}
				</RadioGroup>
			)}
		</div>
	);
}

function Option({
	children,
	disabled,
	multi,
	n,
	value,
}: {
	children: React.ReactNode;
	disabled?: boolean;
	multi: boolean;
	n: number | null;
	value: string;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: 方框或圆点就是这层标签里的控件
		<label
			className={cn(
				"flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-base text-fg",
				disabled && "cursor-not-allowed text-fg-tertiary",
			)}
		>
			{multi ? (
				<Checkbox disabled={disabled} value={value} />
			) : (
				<Radio disabled={disabled} value={value} />
			)}
			<span className="min-w-0 flex-1 truncate">{children}</span>
			{n !== null && (
				<span
					className={cn(
						"shrink-0 text-xs tabular-nums",
						!disabled && "text-fg-secondary",
					)}
				>
					{n}
				</span>
			)}
		</label>
	);
}

// Selected values stay visible so they can always be cleared.
function collapse({ options, values }: FilterField) {
	const head = options.slice(0, VISIBLE);
	const buried = options.filter(
		(o) => values.includes(o.value) && !head.includes(o),
	);
	if (buried.length === 0) return head;
	return [...buried, ...head.slice(0, Math.max(VISIBLE - buried.length, 0))];
}
