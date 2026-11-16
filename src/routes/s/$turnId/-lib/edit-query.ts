import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import type { KeywordBarHandle } from "#/components/keyword-bar";
import type { QueryBarHandle } from "#/components/query-bar";
import type { SearchMode } from "#/server/turn";
import type { View } from "./view-params";

/** 关掉人的详情：回到这一轮的名单，视图原样带着。关详情不进历史。 */
export function useCloseDetail(turnId: string, view: View) {
	const navigate = useNavigate();
	return useCallback(
		() =>
			navigate({
				to: "/s/$turnId",
				params: { turnId },
				search: view,
				replace: true,
			}),
		[navigate, turnId, view],
	);
}

/**
 * 「改查询」这一个动作把光标放到哪：关键词放进名单上方的「经历或技能」；对话在宽屏
 * 放进右栏线程底下的输入框——读着一个人时先把详情收起来，因为两者共用右栏；
 * 窄屏的线程收在抽屉里，先把抽屉打开，输入框随它挂载时拿焦点。
 *
 * 空态请 HR 再说一句时带一句示范说法（`example`），对话的输入框把它当占位，直到这一轮
 * 换成下一轮。只是放光标（按 `/`）不换掉已有的那句。
 */
export function useEditQuery({
	turnId,
	mode,
	wide,
	open,
	closeDetail,
}: {
	turnId: string;
	mode: SearchMode;
	wide: boolean;
	/** 此刻右栏是不是人的详情 */
	open: boolean;
	closeDetail: () => Promise<void>;
}) {
	const composer = useRef<QueryBarHandle>(null);
	const keywordBar = useRef<KeywordBarHandle>(null);
	const [threadOpen, setThreadOpen] = useState(false);
	const [prompt, setPrompt] = useState<{
		turnId: string;
		text: string;
	} | null>(null);
	const editQuery = useCallback(
		async (example?: string) => {
			if (mode === "keyword") {
				keywordBar.current?.focus();
				return;
			}
			if (example) setPrompt({ turnId, text: example });
			if (!wide) {
				setThreadOpen(true);
				return;
			}
			if (open) await closeDetail();
			composer.current?.focus();
		},
		[turnId, mode, wide, open, closeDetail],
	);
	return {
		composer,
		editQuery,
		keywordBar,
		setThreadOpen,
		threadOpen,
		/** 对话输入框此刻的示范说法；没有为 null，用输入框自己的。 */
		example: prompt?.turnId === turnId ? prompt.text : null,
	};
}
