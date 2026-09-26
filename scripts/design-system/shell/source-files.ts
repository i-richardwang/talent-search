import { useSyncExternalStore } from "react";

/*
 * `src/` 下全部 TS、TSX 与 CSS 的原文，键写成仓库路径（`src/…`）。影响范围页和右栏的
 * 本页颜色读它；外壳一打开就在后台加载，读到之前是 null。
 */
const loaders = import.meta.glob<string>("../../../src/**/*.{ts,tsx,css}", {
	import: "default",
	query: "?raw",
});

let files: Record<string, string> | null = null;
const listeners = new Set<() => void>();

void Promise.all(
	Object.entries(loaders).map(
		async ([path, load]) =>
			[path.replace(/^(\.\.\/)+/, ""), await load()] as const,
	),
).then((entries) => {
	files = Object.fromEntries(entries);
	for (const listener of listeners) listener();
});

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export function useSourceFiles(): Record<string, string> | null {
	return useSyncExternalStore(subscribe, () => files);
}
