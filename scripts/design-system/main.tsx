import "#/styles.css";
import { createRoot } from "react-dom/client";
import { PREVIEW_PATH } from "./shared/protocol";

/*
 * 两个页面共用一个入口：`PREVIEW_PATH` 是预览页，其余是外壳。预览页先装好动效的变速，
 * 再加载组件，组件里的动画才都走变速后的时钟。
 */
const root = createRoot(document.getElementById("root") as HTMLElement);

if (location.pathname === PREVIEW_PATH) {
	await import("./preview/playback");
	const { Preview } = await import("./preview/entry");
	root.render(<Preview />);
} else {
	const { App } = await import("./shell/app");
	root.render(<App />);
}
