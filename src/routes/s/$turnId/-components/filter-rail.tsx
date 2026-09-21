import { ChevronDownIcon, ListFilterIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { CheckboxGroup } from "#/components/ui/checkbox-group";
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from "#/components/ui/collapsible";
import { Field, FieldItem, FieldLabel } from "#/components/ui/field";
import { Fieldset, FieldsetLegend } from "#/components/ui/fieldset";
import { Popover, PopoverPopup, PopoverTrigger } from "#/components/ui/popover";
import { Radio, RadioGroup } from "#/components/ui/radio-group";
import { ScrollArea } from "#/components/ui/scroll-area";
import { cn } from "#/lib/utils";
import {
	activeCount,
	type FilterField,
	type TextFilter,
} from "../-lib/filters";
import { CLEARED_FILTERS, type View } from "../-lib/view-params";

const VISIBLE = 5;

export function FilterRail({
	loading,
	...props
}: FilterProps & {
	loading: boolean;
}) {
	const anything = hasAnything(props);
	// Keep the rail width while facets load so the result column stays put.
	if (!anything && !loading) return null;
	return (
		<aside
			aria-label="筛选"
			className={cn(
				"sticky top-(--chrome-height) hidden h-[calc(100dvh-var(--chrome-height))] w-rail shrink-0",
				"overflow-hidden border-border border-r lg:block",
			)}
		>
			<ScrollArea overscrollContain scrollFade>
				{anything && (
					<div className="p-4">
						<FilterList {...props} />
					</div>
				)}
			</ScrollArea>
		</aside>
	);
}

export function FilterSheet({
	loading,
	...props
}: FilterProps & { loading: boolean }) {
	const anything = hasAnything(props);
	if (!anything && !loading) return null;
	const count = activeCount(props.fields, props.textFilters);
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button disabled={!anything} size="sm" variant="outline">
						<ListFilterIcon />
						筛选
						{count > 0 && <span className="tabular-nums">{count}</span>}
					</Button>
				}
			/>
			<PopoverPopup align="start" className="w-72">
				<FilterList {...props} />
			</PopoverPopup>
		</Popover>
	);
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
				<span className="label text-muted-foreground">筛选</span>
				<Button
					className={cn(count === 0 && "invisible")}
					onClick={() => onChange(CLEARED_FILTERS)}
					size="xs"
					variant="link"
				>
					清除 {count} 项
				</Button>
			</div>
			{textFilters.map((t) => (
				<section className="flex flex-col gap-0.5" key={t.key}>
					<h2 className="label px-2 pb-1 text-muted-foreground">{t.title}</h2>
					<Button
						className="w-full justify-start px-2"
						onClick={() => onChange(t.clear)}
						size="sm"
						title={`取消「${t.title} ${t.value}」`}
						variant="secondary"
					>
						<span className="min-w-0 flex-1 truncate text-start">
							{t.value}
						</span>
						<XIcon className="shrink-0 text-muted-foreground" />
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
				<Collapsible onOpenChange={setAll} open={all}>
					<CollapsiblePanel>{rows(rest)}</CollapsiblePanel>
					<CollapsibleTrigger
						className="w-full justify-start px-2 text-muted-foreground data-panel-open:[&_svg]:rotate-180"
						render={<Button size="sm" variant="ghost" />}
					>
						<ChevronDownIcon />
						{all ? "收起" : `更多 ${rest.length} 项`}
					</CollapsibleTrigger>
				</Collapsible>
			)}
		</>
	);

	return (
		<Fieldset className="flex min-w-0 flex-col gap-1">
			<FieldsetLegend className="label px-2 pb-1 text-muted-foreground">
				{field.title}
			</FieldsetLegend>
			<Field className="gap-0">
				{field.multi ? (
					<CheckboxGroup
						className="w-full gap-0"
						onValueChange={(next) => onChange(field.set(next.map(String)))}
						value={field.values}
					>
						{list}
					</CheckboxGroup>
				) : (
					<RadioGroup
						className="w-full gap-0"
						onValueChange={(next) =>
							onChange(field.set(next ? [String(next)] : []))
						}
						value={field.values[0] ?? ""}
					>
						<Option multi={false} n={null} value="">
							不限
						</Option>
						{list}
					</RadioGroup>
				)}
			</Field>
		</Fieldset>
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
		<FieldItem className="px-2" disabled={disabled}>
			<FieldLabel className="w-full cursor-pointer py-1.5">
				{multi ? <Checkbox value={value} /> : <Radio value={value} />}
				<span className="min-w-0 flex-1 truncate">{children}</span>
				{n !== null && (
					<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
						{n}
					</span>
				)}
			</FieldLabel>
		</FieldItem>
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
