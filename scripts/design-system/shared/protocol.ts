import { isPreviewPageId, type PreviewPageId } from "./catalog";
import { type Draft, isDraft } from "./tokens/draft";
import {
	isColorToken,
	SIZE_TIERS,
	type SizeTier,
	type Theme,
} from "./tokens/registry";

/*
 * 外壳、预览页与开发服务器之间的约定。预览页是同源的 iframe（`PREVIEW_PATH`），
 * 外壳把要画的状态和放动画的命令发过去；预览页报告自己准备好了，以及在颜色页上
 * 点选了哪个颜色。两边的 postMessage 与消息监听都只经过这里：只收同源、来自对方窗口、
 * 形状校验通过的消息。
 */

/** 预览页的地址；同一个入口按它分出预览页和外壳。 */
export const PREVIEW_PATH = "/preview";

/** 开发服务器上把修改写回源文件的接口：POST 一份修改，回写入了的文件路径。 */
export const APPLY_PATH = "/__design-system/apply";

export const PLAYBACK_SPEEDS = [1, 0.5, 0.25] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** 预览页要画的样子。 */
export interface PreviewState {
	page: PreviewPageId;
	draft: Draft;
	theme: Theme;
	/** 右栏正在调的那一档尺寸，组件页高亮它。 */
	sizeTier: SizeTier;
	speed: PlaybackSpeed;
	selectedColor: string;
}

/** 外壳打开一页时预览状态的初值（页与修改之外的几项）；换页时尺寸档回到这里。 */
export const INITIAL_PREVIEW = {
	selectedColor: "--color-primary",
	sizeTier: "middle",
	speed: 1,
	theme: "light",
} as const satisfies Omit<PreviewState, "page" | "draft">;

export const MOTION_ACTIONS = ["open", "close", "replay"] as const;
export type MotionAction = (typeof MOTION_ACTIONS)[number];

/** 外壳发给预览页的。 */
type ToPreview =
	| { type: "design-system:state"; state: PreviewState }
	| { type: "design-system:motion"; action: MotionAction };

/** 预览页发给外壳的。 */
type ToShell =
	| { type: "design-system:ready" }
	| { type: "design-system:select-color"; token: string };

const record = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;

function isPreviewState(value: unknown): value is PreviewState {
	const data = record(value);
	return (
		!!data &&
		isPreviewPageId(data.page) &&
		(data.theme === "light" || data.theme === "dark") &&
		SIZE_TIERS.some((tier) => tier === data.sizeTier) &&
		PLAYBACK_SPEEDS.some((speed) => speed === data.speed) &&
		isColorToken(data.selectedColor) &&
		isDraft(data.draft)
	);
}

export function isToPreview(value: unknown): value is ToPreview {
	const data = record(value);
	if (data?.type === "design-system:state") return isPreviewState(data.state);
	return (
		data?.type === "design-system:motion" &&
		MOTION_ACTIONS.some((action) => action === data.action)
	);
}

export function isToShell(value: unknown): value is ToShell {
	const data = record(value);
	return (
		data?.type === "design-system:ready" ||
		(data?.type === "design-system:select-color" && isColorToken(data.token))
	);
}

/** 收 `source` 窗口发来、通过校验的消息；返回取消监听的函数。 */
function listen<Message>(
	source: () => Window | null | undefined,
	accepts: (value: unknown) => value is Message,
	handle: (message: Message) => void,
) {
	const receive = (event: MessageEvent) => {
		const from = source();
		if (event.origin !== location.origin || !from || event.source !== from)
			return;
		if (accepts(event.data)) handle(event.data);
	};
	window.addEventListener("message", receive);
	return () => window.removeEventListener("message", receive);
}

/** 外壳：发给一块预览框里的预览页。 */
export const sendToPreview = (
	frame: Window | null | undefined,
	message: ToPreview,
) => frame?.postMessage(message, location.origin);

/** 外壳：听一块预览框里的预览页。 */
export const listenToPreview = (
	frame: () => Window | null | undefined,
	handle: (message: ToShell) => void,
) => listen(frame, isToShell, handle);

/** 预览页：发给外壳。 */
export const sendToShell = (message: ToShell) =>
	window.parent.postMessage(message, location.origin);

/** 预览页：听外壳。 */
export const listenToShell = (handle: (message: ToPreview) => void) =>
	listen(() => window.parent, isToPreview, handle);
