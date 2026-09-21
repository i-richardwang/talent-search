import { LoaderIcon } from "lucide-react";
import type React from "react";
import { cn } from "#/lib/utils";

/**
 * 等待标记。全产品只有这一个——按钮里那个小的和检索时那个大的是同一个记号，
 * 换一个地方换一种转法，用户就得重新认一次「这是在等」。
 *
 * 用 12 根辐条的 `Loader` 配 `animate-tick`（一格一跳，见 styles.css），不用
 * `Loader2` 配 `animate-spin`：后者是匀速转的一段圆弧，也是每个 CSS 框架自带
 * 的那一个。辐条逐格点亮是系统自己的画法，不像装上去的部件。
 */
export function Spinner({
	className,
	...props
}: React.ComponentProps<typeof LoaderIcon>): React.ReactElement {
	return (
		<LoaderIcon
			aria-label="Loading"
			className={cn("animate-tick", className)}
			role="status"
			{...props}
		/>
	);
}
