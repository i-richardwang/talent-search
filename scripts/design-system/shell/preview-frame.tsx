import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Segmented } from "#/components/ui/segmented";
import { cn } from "#/lib/utils";
import {
	INITIAL_PREVIEW,
	listenToPreview,
	MOTION_ACTIONS,
	type MotionAction,
	PLAYBACK_SPEEDS,
	type PlaybackSpeed,
	PREVIEW_PATH,
	type PreviewState,
	sendToPreview,
} from "../shared/protocol";
import { SCOPE_LABEL } from "../shared/tokens/registry";

const MOTION_LABEL: Record<MotionAction, string> = {
	close: "关闭",
	open: "打开",
	replay: "重播",
};

/**
 * 一块预览：iframe 里加载预览页，上面一条写是修改前还是修改后、哪种外观。有进出场可放的页
 * 多一条放动画的工具条；预览速度每块各记一份，并排对比时两块各放各的。
 */
export function PreviewFrame({
	compare,
	motion,
	onSelectColor,
	original,
	state: shared,
}: {
	compare: boolean;
	/** 这一页有进出场可放。 */
	motion: boolean;
	onSelectColor: (token: string) => void;
	/** 画修改前的样子（不带修改）。 */
	original: boolean;
	state: Omit<PreviewState, "speed">;
}) {
	const frame = useRef<HTMLIFrameElement>(null);
	const [speed, setSpeed] = useState<PlaybackSpeed>(INITIAL_PREVIEW.speed);
	const state: PreviewState = { ...shared, speed };
	const send = useEffectEvent(() =>
		sendToPreview(frame.current?.contentWindow, {
			state,
			type: "design-system:state",
		}),
	);
	const select = useEffectEvent(onSelectColor);
	useEffect(
		() =>
			listenToPreview(
				() => frame.current?.contentWindow,
				(message) => {
					if (message.type === "design-system:ready") send();
					else select(message.token);
				},
			),
		[],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 状态的内容一变就发
	useEffect(() => {
		send();
	}, [shared, speed]);
	const label = original ? "修改前" : "修改后";
	return (
		<Block
			as="section"
			className={cn("min-w-0 flex-1 overflow-hidden", compare && "min-w-md")}
			shadow
			variant="outlined"
		>
			<div className="flex items-center gap-2 border-border-secondary border-b px-3.5 py-2.5 text-fg-tertiary text-xs">
				<span
					className={cn(
						"size-1.5 rounded-full",
						original ? "bg-fg-quaternary" : "bg-info",
					)}
				/>
				{label}
				<span className="ml-auto">{SCOPE_LABEL[state.theme]}</span>
			</div>
			{motion && (
				<div className="flex items-center gap-1 border-border-secondary border-b px-3.5 py-1">
					{MOTION_ACTIONS.map((action) => (
						<Button
							key={action}
							onClick={() =>
								sendToPreview(frame.current?.contentWindow, {
									action,
									type: "design-system:motion",
								})
							}
							size="small"
							type="text"
						>
							{MOTION_LABEL[action]}
						</Button>
					))}
					<span className="ml-auto text-fg-tertiary text-xs">预览速度</span>
					<Segmented<`${PlaybackSpeed}`>
						aria-label="预览速度"
						onChange={(value) => setSpeed(Number(value) as PlaybackSpeed)}
						options={PLAYBACK_SPEEDS.map((value) => ({
							label: `${value}×`,
							value: `${value}` as const,
						}))}
						size="small"
						value={`${speed}`}
					/>
				</div>
			)}
			<iframe
				className="block min-h-0 w-full flex-1 bg-layout"
				ref={frame}
				src={PREVIEW_PATH}
				title={label}
			/>
		</Block>
	);
}
