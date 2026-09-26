import { type ReactNode, useState } from "react";
import { Button } from "#/components/ui/button";
import { TableCell, TableRow } from "#/components/ui/table";

/**
 * 弹层形态表的一行：写法、形态，第三格的「打开」打开按这一行配置的弹层
 * （对话框或抽屉）。开合状态在这一行里。
 */
export function OverlayRow({
	code,
	label,
	render,
}: {
	code: string;
	label: string;
	render: (open: boolean, close: () => void) => ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<TableRow>
			<TableCell className="font-mono text-xs">{code}</TableCell>
			<TableCell className="text-fg-secondary">{label}</TableCell>
			<TableCell>
				<Button onClick={() => setOpen(true)} size="small">
					打开
				</Button>
				{render(open, () => setOpen(false))}
			</TableCell>
		</TableRow>
	);
}
