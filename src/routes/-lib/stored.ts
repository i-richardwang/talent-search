import { useCallback, useSyncExternalStore } from "react";

/*
 * 这台浏览器记住的界面偏好（右栏的宽），存在 localStorage。读写都可能抛错（隐私窗口、
 * 禁用了站点数据）：这一页里改过的值另记在内存里，存不进去也照样生效，只是下次打开
 * 回到默认值。服务端和水合那一帧按默认值画。
 */

const PREFIX = "talent-search:";

const listeners = new Set<() => void>();
/** 这一页里写过的值，先于 localStorage 读；别的标签页改了同一项时丢掉，改读 localStorage。 */
const memory = new Map<string, string>();

function onStorage(event: StorageEvent) {
	if (event.key?.startsWith(PREFIX))
		memory.delete(event.key.slice(PREFIX.length));
	for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
	if (listeners.size === 0) addEventListener("storage", onStorage);
	listeners.add(onChange);
	return () => {
		listeners.delete(onChange);
		if (listeners.size === 0) removeEventListener("storage", onStorage);
	};
}

function read(key: string): string | null {
	const kept = memory.get(key);
	if (kept !== undefined) return kept;
	try {
		return localStorage.getItem(PREFIX + key);
	} catch {
		return null;
	}
}

function write(key: string, value: string) {
	memory.set(key, value);
	try {
		localStorage.setItem(PREFIX + key, value);
	} catch {}
	for (const listener of listeners) listener();
}

/** 记住的宽度（px），夹在 `min`–`max` 之间；没记过或记的不是数就用 `fallback`。 */
export function useStoredWidth(
	key: string,
	{ fallback, min, max }: { fallback: number; min: number; max: number },
) {
	const raw = useSyncExternalStore(
		subscribe,
		() => read(key),
		() => null,
	);
	const parsed = raw === null ? Number.NaN : Number(raw);
	const width = Number.isFinite(parsed)
		? Math.min(Math.max(parsed, min), max)
		: fallback;
	const setWidth = useCallback(
		(next: number) => write(key, String(Math.round(next))),
		[key],
	);
	return [width, setWidth] as const;
}
