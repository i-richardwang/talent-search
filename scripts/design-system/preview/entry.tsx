import { useEffect, useState } from "react";
import { ModalHost } from "#/components/ui/modal";
import { Toaster } from "#/components/ui/toast";
import {
	listenToShell,
	type PreviewState,
	sendToShell,
} from "../shared/protocol";
import { previewCss } from "../shared/tokens/css";
import { PAGES } from "./pages";
import { setPlaybackRate } from "./playback";
import { PreviewStateContext } from "./state";

/*
 * 预览页（`PREVIEW_PATH`）：外壳里的 iframe。收到状态后按它切深浅、把修改版写成一段
 * CSS 压在源样式上面、设好动效速度，再画目录里对应的那一页。页就是用生产组件搭的，
 * 不另写组件的样式。
 */

export function Preview() {
	const [state, setState] = useState<PreviewState | null>(null);
	useEffect(() => {
		const stop = listenToShell((message) => {
			if (message.type === "design-system:state") setState(message.state);
		});
		sendToShell({ type: "design-system:ready" });
		return stop;
	}, []);
	useEffect(() => {
		document.documentElement.classList.toggle("dark", state?.theme === "dark");
	}, [state?.theme]);
	useEffect(() => {
		setPlaybackRate(state?.speed ?? 1);
	}, [state?.speed]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 换页时回到页顶
	useEffect(() => {
		window.scrollTo(0, 0);
	}, [state?.page]);
	if (!state) return null;
	const Page = PAGES[state.page];
	return (
		<PreviewStateContext value={state}>
			<style>{previewCss(state.draft)}</style>
			<div className="min-h-dvh bg-layout text-fg">
				<Page />
			</div>
			<Toaster />
			<ModalHost />
		</PreviewStateContext>
	);
}
