import type { LucideIcon } from "lucide-react";
import { Block } from "#/components/ui/block";
import { Icon } from "#/components/ui/icon";

/** 对话里一行开头的描边图标格：检索人才库的一步，AI 回应里的一条搜索条件。 */
export function IconCell({
	icon,
	className,
	spin = false,
}: {
	icon: LucideIcon;
	/** 图标的颜色 */
	className: string;
	spin?: boolean;
}) {
	return (
		<Block
			align="center"
			className="shrink-0"
			height={24}
			horizontal
			justify="center"
			variant="outlined"
			width={24}
		>
			<Icon
				aria-hidden="true"
				className={className}
				icon={icon}
				size={12}
				spin={spin}
			/>
		</Block>
	);
}
