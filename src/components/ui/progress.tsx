import { Progress as BaseProgress } from "@base-ui/react/progress";
import { cn } from "#/lib/utils";

/* 一根进度条。条只画比例，读的是旁边写出来的数。 */

export function Progress({
	value,
	max,
	className,
	"aria-label": label,
}: {
	value: number;
	max: number;
	className?: string;
	"aria-label": string;
}) {
	return (
		<BaseProgress.Root
			aria-label={label}
			className={cn("ui-progress", className)}
			max={max}
			value={value}
		>
			<BaseProgress.Track className="ui-progress-track">
				<BaseProgress.Indicator className="ui-progress-indicator" />
			</BaseProgress.Track>
		</BaseProgress.Root>
	);
}
