import { useLoaderData, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { Segmented } from "#/components/ui/segmented";
import { AppShell } from "#/routes/-components/app-shell";
import { HomeScreen } from "#/routes/-components/home-screen";
import { type RootData, Routed } from "../../routed";

/*
 * 页面布局模块共用的外壳：产品的 `AppShell`。最近搜索有哪几条由预览页自己的内存
 * router 给出（`routed.tsx`），链接也走它。
 */

/** `<body>` 那一层的字色，然后是产品外壳和这一屏的内容。 */
export function Shell({ children }: { children: ReactNode }) {
	return (
		<div className="text-fg">
			<AppShell>{children}</AppShell>
		</div>
	);
}

/** 浮在页底正中的一个切换：换这一屏的状态，不属于产品界面。 */
export function LayoutSwitch<Value extends string>({
	label,
	onChange,
	options,
	value,
}: {
	label: string;
	onChange: (next: Value) => void;
	options: { label: string; value: Value }[];
	value: Value;
}) {
	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-4 z-stick flex justify-center">
			<div className="pointer-events-auto">
				<Segmented<Value>
					aria-label={label}
					onChange={onChange}
					options={options}
					value={value}
				/>
			</div>
		</div>
	);
}

/** 首页的几种样子：有没有搜索记录、取不取得到，AI 服务配没配。 */
type HomeState = "recent" | "empty" | "failed" | "keyword-only";

const STATES: { label: string; value: HomeState }[] = [
	{ label: "有搜索记录", value: "recent" },
	{ label: "还没有记录", value: "empty" },
	{ label: "记录取不到", value: "failed" },
	{ label: "未配置 AI 服务", value: "keyword-only" },
];

/** 根路由提供的几项按状态换掉；有记录是样例的默认值。 */
const ROOT: Record<HomeState, Partial<RootData>> = {
	empty: { recent: { from: 0, page: 1, pages: 1, rows: [], total: 0 } },
	failed: { recent: null },
	"keyword-only": { understanding: false },
	recent: {},
};

/** 首页的正文：产品的 `HomeScreen`，数据读内存 router 根路由提供的那一份。 */
function Home() {
	const asked = useRouterState({
		select: (state) => (state.location.search as { mode?: "keyword" }).mode,
	});
	const { recent, understanding } = useLoaderData({ from: "__root__" });
	return (
		<HomeScreen
			asked={asked}
			error={null}
			onQuery={() => true}
			recent={recent}
			understanding={understanding}
		/>
	);
}

/**
 * 首页：导航栏右边的卡片里，问句和输入托盘落在中线上，下面是最近搜索；还没有记录时
 * 换成起步的例子。页底的切换换这一屏的状态，换一次重建一次内存 router。
 */
export function HomePage() {
	const [state, setState] = useState<HomeState>("recent");
	return (
		<>
			<Routed key={state} root={ROOT[state]} url="/">
				<Shell>
					<Home />
				</Shell>
			</Routed>
			<LayoutSwitch<HomeState>
				label="首页的状态"
				onChange={setState}
				options={STATES}
				value={state}
			/>
		</>
	);
}
