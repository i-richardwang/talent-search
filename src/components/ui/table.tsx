import type {
	ComponentProps,
	KeyboardEvent,
	MouseEvent,
	ReactNode,
	SyntheticEvent,
} from "react";
import { Skeleton } from "#/components/ui/skeleton";
import { cn } from "#/lib/utils";

/*
 * 表放在一块描边的 `Block` 里，圆角和外框归那块面，表自己不画圆角。
 *
 * - 整行可点：`TableRow` 的 `onActivate`。行进 Tab 序，回车、空格也触发；点在行里的
 *   控件上时归控件自己。通往详情的名字仍是一个真链接（`TextLink`），所在的格标
 *   `cellSlot="title"`。
 * - `narrow="cards"`：表的宽度不到 600px 时每一行排成一张卡片，每格左边是 `cellLabel`；
 *   默认 `"scroll"` 是窄于表时横向滚动。
 */

interface TableProps
	extends Omit<ComponentProps<"table">, "className" | "style"> {
	busy?: boolean;
	className?: string;
	footer?: ReactNode;
	narrow?: "scroll" | "cards";
}

export function Table({
	busy,
	className,
	footer,
	narrow = "scroll",
	...props
}: TableProps) {
	return (
		<div
			aria-busy={busy || undefined}
			className={cn(
				"ui-table-wrapper",
				narrow === "cards" && "ui-table-narrow-cards",
				className,
			)}
		>
			<div className="ui-table">
				<div className="ui-table-container">
					<div className="ui-table-content">
						<table {...props} />
					</div>
				</div>
				{footer != null && <div className="ui-table-footer">{footer}</div>}
			</div>
		</div>
	);
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
	return <thead className={cn("ui-table-thead", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
	return <tbody className={cn("ui-table-tbody", className)} {...props} />;
}

/** 行里自己会响应点击的东西：点在它们上面时归它们，不算点了这一行。 */
const CONTROLS =
	"a, button, input, select, textarea, label, [role='button'], [role='checkbox'], [role='switch'], [role='menuitem']";

function hitsControl(event: SyntheticEvent<HTMLTableRowElement>) {
	const control = (event.target as Element).closest(CONTROLS);
	return control !== null && event.currentTarget.contains(control);
}

interface TableRowProps extends ComponentProps<"tr"> {
	/** 点击这一行、在行上按回车或空格时调用。 */
	onActivate?: () => void;
}

export function TableRow({
	className,
	onActivate,
	onClick,
	onKeyDown,
	...props
}: TableRowProps) {
	if (!onActivate)
		return (
			<tr
				className={cn("ui-table-row", className)}
				onClick={onClick}
				onKeyDown={onKeyDown}
				{...props}
			/>
		);

	const click = (event: MouseEvent<HTMLTableRowElement>) => {
		onClick?.(event);
		if (event.defaultPrevented || hitsControl(event)) return;
		// 带修饰键的点击是想开新标签页或多选，行没有地址可开，不当成打开
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		// 拖选单元格里的字（抄工号）不算点开
		if (window.getSelection()?.toString()) return;
		onActivate();
	};
	const keyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
		onKeyDown?.(event);
		// 只处理焦点在行本身时的按键；格里控件上的回车、空格归控件
		if (event.defaultPrevented || event.target !== event.currentTarget) return;
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		onActivate();
	};
	return (
		<tr
			className={cn("ui-table-row", className)}
			data-clickable=""
			onClick={click}
			onKeyDown={keyDown}
			tabIndex={0}
			{...props}
		/>
	);
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
	return (
		<th className={cn("ui-table-cell", className)} scope="col" {...props} />
	);
}

interface TableCellProps extends ComponentProps<"td"> {
	/** 卡片形态里这一格左边的标签，通常就是列头的字。 */
	cellLabel?: string;
	/** 名字那一格：卡片形态里是卡片标题。 */
	cellSlot?: "title";
}

export function TableCell({
	cellLabel,
	cellSlot,
	className,
	...props
}: TableCellProps) {
	return (
		<td
			className={cn("ui-table-cell", className)}
			data-label={cellLabel}
			data-slot={cellSlot}
			{...props}
		/>
	);
}

/** 加载中的表体，表头和外框照常画；外层 `busy` 同时给上。 */
export function TableSkeletonRows({
	columns,
	rows = 4,
}: {
	columns: number;
	rows?: number;
}) {
	return Array.from({ length: rows }, (_, row) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: 占位行只按位置区分
		<TableRow aria-hidden key={row}>
			{Array.from({ length: columns }, (_, column) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: 占位格只按位置区分
				<TableCell key={column}>
					<Skeleton height="var(--text-base)" />
				</TableCell>
			))}
		</TableRow>
	));
}
