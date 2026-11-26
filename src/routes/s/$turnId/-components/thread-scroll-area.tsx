import { ArrowDownIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { ScrollArea } from "#/components/ui/scroll-area";

interface ThreadView {
	viewing: string;
	latestId: string;
	phase: "running" | "settled" | "failed";
	stepCount: number;
}

/** 离底超过这段距离时显示「跳转到最新」，进度更新时保留阅读位置。 */
const OVERFLOW_THRESHOLD = { yEnd: 300 };

function revealCurrentRound(viewport: HTMLElement) {
	const round = viewport.querySelector('li[aria-current="page"]');
	if (!round) return;
	const bounds = viewport.getBoundingClientRect();
	const { top, bottom } = round.getBoundingClientRect();
	if (bottom <= bounds.top || top >= bounds.bottom)
		viewport.scrollTop += top - bounds.top;
}

export function ThreadScrollArea({
	children,
	viewing,
	latestId,
	phase,
	stepCount,
}: ThreadView & { children: ReactNode }) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const previous = useRef<ThreadView | null>(null);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const last = previous.current;
		previous.current = { viewing, latestId, phase, stepCount };
		const viewingLatest = viewing === latestId;
		if (viewingLatest && last?.latestId !== latestId) {
			viewport.scrollTop = viewport.scrollHeight;
		} else if (last?.viewing !== viewing) {
			revealCurrentRound(viewport);
		} else if (
			viewingLatest &&
			(last.phase !== phase || last.stepCount !== stepCount) &&
			!viewport.hasAttribute("data-overflow-y-end")
		) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}, [viewing, latestId, phase, stepCount]);

	function jumpToLatest() {
		const viewport = viewportRef.current;
		viewport?.scrollTo({
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
			top: viewport.scrollHeight,
		});
	}

	return (
		<div className="relative min-h-0 flex-1">
			<ScrollArea
				className="peer size-full"
				overflowEdgeThreshold={OVERFLOW_THRESHOLD}
				viewportProps={{
					className: "data-has-overflow-y:overscroll-y-contain",
					ref: viewportRef,
				}}
			>
				{children}
			</ScrollArea>
			<ActionIcon
				className="absolute end-4 bottom-4 z-raise transition-[opacity,translate,visibility] duration-200 ease-out peer-not-data-overflow-y-end:invisible peer-not-data-overflow-y-end:translate-y-4 peer-not-data-overflow-y-end:opacity-0"
				glass
				icon={ArrowDownIcon}
				onClick={jumpToLatest}
				size="floating"
				title="跳转到最新"
				variant="outlined"
			/>
		</div>
	);
}
