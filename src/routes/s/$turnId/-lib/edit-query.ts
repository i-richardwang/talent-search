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
 */
export function useEditQuery({
	mode,
	wide,
	open,
	closeDetail,
}: {
	mode: SearchMode;
	wide: boolean;
	/** 此刻右栏是不是人的详情 */
	open: boolean;
	closeDetail: () => Promise<void>;
}) {
	const composer = useRef<QueryBarHandle>(null);
	const keywordBar = useRef<KeywordBarHandle>(null);
	const [threadOpen, setThreadOpen] = useState(false);
	const editQuery = useCallback(async () => {
		if (mode === "keyword") {
			keywordBar.current?.focus();
			return;
		}
		if (!wide) {
			setThreadOpen(true);
			return;
		}
		if (open) await closeDetail();
		composer.current?.focus();
	}, [mode, wide, open, closeDetail]);
	return { composer, editQuery, keywordBar, setThreadOpen, threadOpen };
}
