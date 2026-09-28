import { useState } from "react";
import { type Draft, emptyDraft, isDraft } from "../shared/tokens/draft";

/*
 * 存在这台浏览器 localStorage 里的东西：当前的修改与保存的方案（最多 `MAX_SCHEMES` 个），
 * 以及外壳的几项偏好。读不到、写不进或内容不合形状时退回空的一份，页面照常能用；
 * 写不进时外壳提示一次，修改只在这个标签页里。
 */

const KEY_PREFIX = "design-system:";
const SESSION_KEY = `${KEY_PREFIX}session`;
export const MAX_SCHEMES = 20;
export const MAX_NAME = 60;

/** 保存的一组修改。 */
export interface Scheme {
	id: string;
	name: string;
	draft: Draft;
	savedAt: string;
}

interface Session {
	draft: Draft;
	schemes: Scheme[];
}

const fresh = (): Session => ({ draft: emptyDraft(), schemes: [] });

const isScheme = (value: unknown): value is Scheme => {
	if (!value || typeof value !== "object") return false;
	const item = value as Record<string, unknown>;
	return (
		typeof item.id === "string" &&
		typeof item.name === "string" &&
		item.name.length > 0 &&
		item.name.length <= MAX_NAME &&
		typeof item.savedAt === "string" &&
		isDraft(item.draft)
	);
};

export function decodeSession(raw: string | null): Session {
	if (!raw) return fresh();
	try {
		const data = JSON.parse(raw) as Record<string, unknown>;
		if (!isDraft(data.draft) || !Array.isArray(data.schemes)) return fresh();
		return {
			draft: data.draft,
			schemes: data.schemes.filter(isScheme).slice(0, MAX_SCHEMES),
		};
	} catch {
		return fresh();
	}
}

export function loadSession(): Session {
	try {
		return decodeSession(localStorage.getItem(SESSION_KEY));
	} catch {
		return fresh();
	}
}

/** 写入当前会话；写不进时返回 false。 */
export function saveSession(session: Session): boolean {
	try {
		localStorage.setItem(SESSION_KEY, JSON.stringify(session));
		return true;
	} catch {
		return false;
	}
}

/** 外壳的一项偏好；读不到或不在取值里时取 `initial`。 */
export function useSetting<T extends string>(
	key: string,
	values: readonly T[],
	initial: T,
): [T, (value: T) => void] {
	const storageKey = `${KEY_PREFIX}${key}`;
	const [value, setValue] = useState<T>(() => {
		try {
			const stored = localStorage.getItem(storageKey);
			return values.find((item) => item === stored) ?? initial;
		} catch {
			return initial;
		}
	});
	const update = (next: T) => {
		setValue(next);
		try {
			localStorage.setItem(storageKey, next);
		} catch {}
	};
	return [value, update];
}
