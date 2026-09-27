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
 * 数据表，样式在 table.css。结构是外层 `.ui-table-wrapper` → `.ui-table`（带尺寸类）
 * → `-container` → `-content` → `<table>`，表脚 `-footer` 接在 `-container` 后面，
 * 都在 `.ui-table` 里。表放在一块描边的 `Block` 里，圆角和外框归那块面，表自己不画圆角。
 *
 * - 表头、行、单元格由调用处用 `TableHeader`、`TableBody`、`TableRow`、`TableHead`、
 *   `TableCell` 写出来。列宽、对齐由调用处写在单元格的类名上。
 * - `footer` 直接是内容。
 * - 选中的行是 `TableRow` 的 `data-state="selected"`，没有勾选列；行悬停用 `:hover`。
 * - 整行可点：`TableRow` 的 `onActivate`。行进 Tab 序，回车、空格也触发；点在行里的
 *   链接、按钮等控件上时归控件自己。通往详情的名字仍是一个真链接（`TextLink`），
 *   中键、右键、新标签页照常；它所在的格标 `cellSlot="title"`，行悬停时这格换成链接色。
 * - `stickyHeader`：表头钉在表的顶上，表体在表自己的盒子里纵向滚动；盒子的高度由
 *   调用处写在 `className` 上（`max-h-*` 或撑满的布局）。
 * - `narrow="cards"`：表的宽度不到 600px 时每一行排成一张卡片，表头不画，每格左边是
 *   `cellLabel`、右边是值；`cellSlot="title"` 的格是卡片标题，`"extra"` 在标题右边，
 *   `"actions"` 靠右。默认 `"scroll"`：窄于表时表在自己的盒子里横向滚动。
 * - 加载中：`busy` 让外层带 `aria-busy`，表体里放 `TableSkeletonRows`，表头和外框不变。
 * - 空表由调用处给 `Empty`。
 */

type TableSize = "small" | "middle" | "large";

interface TableProps
	extends Omit<ComponentProps<"table">, "className" | "style"> {
	busy?: boolean;
	className?: string;
	/** 表下的一条表脚，和表同一块面。 */
	footer?: ReactNode;
	narrow?: "scroll" | "cards";
	size?: TableSize;
	stickyHeader?: boolean;
	tableLayout?: "auto" | "fixed";
}

const SIZE = {
	large: null,
	middle: "ui-table-size-middle",
	small: "ui-table-size-small",
} as const;

export function Table({
	busy,
	className,
	footer,
	narrow = "scroll",
	size = "large",
	stickyHeader,
	tableLayout,
	...props
}: TableProps) {
	return (
		<div
			aria-busy={busy || undefined}
			className={cn(
				"ui-table-wrapper",
				narrow === "cards" && "ui-table-narrow-cards",
				stickyHeader && "ui-table-sticky",
				className,
			)}
		>
			<div className={cn("ui-table", SIZE[size])}>
				<div className="ui-table-container">
					<div className="ui-table-content">
						<table style={{ tableLayout }} {...props} />
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
	/** 整行可点：点击这一行、在行上按回车或空格时调用。 */
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
		// 只认焦点在行本身时的按键；格里控件上的回车、空格归控件
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
	/** 这一格在一行里的角色：名字（`title`）、标题旁的附加（`extra`）、动作（`actions`）。 */
	cellSlot?: "title" | "extra" | "actions";
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

/** 加载中的表体：`rows` 行、每行 `columns` 格占位，表头和外框照常画。 */
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
