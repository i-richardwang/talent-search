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
 * 筛选：名单正上方的一排，一维一个 `FilterButton`，点开是这一维的下拉菜单。筛选是改看法，
 * 不是改条件，所以和条件那一排的胶囊长得不一样，也不进线程。
 *
 * 钮上写维度名；选了东西时钮铺上底色，名字后面跟选中的那一项，选了几项就写几项。
 * 菜单里每一项行尾写着选了之后还剩几个人（和名单表头同一口径），数到 0 的一项留在原地、
 * 点不了，选中的一项归零了也点得动，否则取消不掉。多选的维是勾选项，勾一项菜单不收起；
 * 单选的维最前面是「不限」。
 *
 * 数不出人的维不出现。一维都数不出人、也没有生效的文本条件时，路由不放这一排。
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

/** 钮上的字：维度名，选了一项跟那一项，选了几项写几项。 */
export function fieldLabel(field: FilterField): string {
	const picked = field.options.filter((o) => field.values.includes(o.value));
	if (picked.length === 0) return field.title;
	if (picked.length === 1) return `${field.title}：${picked[0]?.label}`;
	return `${field.title}：${picked.length} 项`;
}

/**
 * 一维的菜单项。多选的维：每个候选一项勾选项，选了东西时末尾隔一条线放「清除」；
 * 单选的维：一组单选项，最前面是「不限」。
 */
export function fieldItems(
	field: FilterField,
	onChange: (next: Partial<View>) => void,
): DropdownItem[] {
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
