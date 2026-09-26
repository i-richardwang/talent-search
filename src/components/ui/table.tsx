import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 数据表，样式在 table.css。结构是外层 `.ui-table-wrapper` → `.ui-table`（带尺寸类）
 * → `-container` → `-content` → `<table>`，表脚 `-footer` 接在 `-container` 后面，
 * 都在 `.ui-table` 里。
 *
 * - 表头、行、单元格由调用处用 `TableHeader`、`TableBody`、`TableRow`、`TableHead`、
 *   `TableCell` 写出来，得到 `<thead>` / `<tbody>` / `<tr>` / `<th scope="col">` /
 *   `<td>` 与各自的类名。列宽、对齐由调用处写在单元格的类名上。
 * - `footer` 直接是内容。
 * - 选中的行是 `TableRow` 的 `data-state="selected"`，没有勾选列；行悬停用 `:hover`。
 * - `-content` 总是 `overflow-x: auto`：窄于表时表在自己的盒子里横向滚动，
 *   页面不出横向滚动条。
 * - 空表由调用处给 `Empty`。
 */

type TableSize = "small" | "middle" | "large";

interface TableProps
	extends Omit<ComponentProps<"table">, "className" | "style"> {
	className?: string;
	/** 表下的一条表脚，和表同一块面。 */
	footer?: ReactNode;
	size?: TableSize;
	tableLayout?: "auto" | "fixed";
}

const SIZE = {
	large: null,
	middle: "ui-table-size-middle",
	small: "ui-table-size-small",
} as const;

export function Table({
	className,
	footer,
	size = "large",
	tableLayout,
	...props
}: TableProps) {
	return (
		<div className={cn("ui-table-wrapper", className)}>
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

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
	return <tr className={cn("ui-table-row", className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
	return (
		<th className={cn("ui-table-cell", className)} scope="col" {...props} />
	);
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
	return <td className={cn("ui-table-cell", className)} {...props} />;
}
