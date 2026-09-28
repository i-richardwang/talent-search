import type { ComponentProps } from "react";
import { cn } from "#/lib/utils";

/* 一个按钮，放进气泡卡片或下拉菜单的触发器，点开看每一项。 */

const RING = { size: 16, stroke: 3 } as const;
const RADIUS = (RING.size - RING.stroke) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressTag({
	value,
	total,
	className,
	...props
}: Omit<ComponentProps<"button">, "children"> & {
	value: number;
	total: number;
}) {
	const ratio = total === 0 ? 0 : Math.min(value / total, 1);
	return (
		<button
			className={cn("ui-progress-tag", className)}
			type="button"
			{...props}
		>
			<svg
				aria-hidden="true"
				className="ui-progress-tag-ring"
				height={RING.size}
				viewBox={`0 0 ${RING.size} ${RING.size}`}
				width={RING.size}
			>
				<circle
					className="ui-progress-tag-trail"
					cx={RING.size / 2}
					cy={RING.size / 2}
					fill="none"
					r={RADIUS}
					strokeWidth={RING.stroke}
				/>
				{ratio > 0 && (
					<circle
						className="ui-progress-tag-bar"
						cx={RING.size / 2}
						cy={RING.size / 2}
						fill="none"
						r={RADIUS}
						strokeDasharray={`${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`}
						strokeLinecap="round"
						strokeWidth={RING.stroke}
						transform={`rotate(-90 ${RING.size / 2} ${RING.size / 2})`}
					/>
				)}
			</svg>
			<span className="ui-progress-tag-text">
				{value}/{total}
			</span>
		</button>
	);
}
ProgressTag.displayName = "ProgressTag";
