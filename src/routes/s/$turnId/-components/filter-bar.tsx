import {
	type DropdownItem,
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { FilterButton } from "#/components/ui/filter-button";
import type { FilterField, TextFilter } from "../-lib/filters";
import type { View } from "../-lib/view-params";

/**
 * 名单正上方的筛选，一维一个菜单。筛选改的是视图，不是条件，所以和条件那一排
 * 长得不一样，也不进线程。数不出人的维不出现。
 */
export function FilterBar({
	fields,
	textFilters,
	onChange,
}: {
	fields: FilterField[];
	textFilters: TextFilter[];
	onChange: (next: Partial<View>) => void;
}) {
	const shown = fields.filter((f) => f.options.length > 0);
	return (
		<div
			aria-label="筛选"
			className="flex flex-wrap items-center gap-1"
			role="toolbar"
		>
			{textFilters.map((t) => (
				<FilterMenu
					active
					items={[
						{ key: "clear", label: "清除", onClick: () => onChange(t.clear) },
					]}
					key={t.key}
					label={`${t.title}：${t.value}`}
				/>
			))}
			{shown.map((field) => (
				<FilterMenu
					active={field.values.length > 0}
					items={fieldItems(field, onChange)}
					key={field.key}
					label={fieldLabel(field)}
				/>
			))}
		</div>
	);
}

function FilterMenu({
	active,
	label,
	items,
}: {
	active: boolean;
	label: string;
	items: DropdownItem[];
}) {
	return (
		<DropdownMenuRoot>
			<DropdownMenuTrigger>
				<FilterButton active={active}>{label}</FilterButton>
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuPositioner>
					<DropdownMenuPopup>
						{renderDropdownMenuItems(items)}
					</DropdownMenuPopup>
				</DropdownMenuPositioner>
			</DropdownMenuPortal>
		</DropdownMenuRoot>
	);
}

function fieldLabel(field: FilterField): string {
	const picked = field.options.filter((o) => field.values.includes(o.value));
	if (picked.length === 0) return field.title;
	if (picked.length === 1) return `${field.title}：${picked[0]?.label}`;
	return `${field.title}：${picked.length} 项`;
}

export function fieldItems(
	field: FilterField,
	onChange: (next: Partial<View>) => void,
): DropdownItem[] {
	// 数到 0 的一项点不了；选中的一项归零了也点得动，否则取消不掉
	const disabled = (o: FilterField["options"][number]) =>
		o.n === 0 && !field.values.includes(o.value);
	if (!field.multi)
		return [
			{
				onValueChange: (value) => onChange(field.set(value ? [value] : [])),
				options: [
					{ label: "不限", value: "" },
					...field.options.map((o) => ({
						disabled: disabled(o),
						extra: o.n,
						label: o.label,
						value: o.value,
					})),
				],
				type: "radio",
				value: field.values[0] ?? "",
			},
		];
	const items: DropdownItem[] = field.options.map((o) => ({
		checked: field.values.includes(o.value),
		disabled: disabled(o),
		extra: o.n,
		key: o.value,
		label: o.label,
		onCheckedChange: (checked) =>
			onChange(
				field.set(
					checked
						? [...field.values, o.value]
						: field.values.filter((v) => v !== o.value),
				),
			),
		type: "checkbox",
	}));
	if (field.values.length === 0) return items;
	return [
		...items,
		{ type: "divider" },
		{ key: "clear", label: "清除", onClick: () => onChange(field.set([])) },
	];
}
