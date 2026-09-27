import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { Segmented } from "#/components/ui/segmented";
import { AppShell } from "#/routes/-components/app-shell";
import { HomeScreen } from "#/routes/-components/home-screen";
import { Routed } from "../../routed";

/*
 * 页面布局模块共用的外壳：产品的 `AppShell`。导航栏放什么、最近搜索有哪几条，
 * 都由预览页自己的内存 router 按地址给出（`routed.tsx`），链接也走它。
 */

/** `<body>` 那一层的字色，然后是产品外壳和这一屏的内容。 */
export function Shell({ children }: { children: ReactNode }) {
	return (
		<div className="text-fg">
			<AppShell>{children}</AppShell>
		</div>
	);
}

/** 浮在页底正中的一个切换：换这一屏的状态，不属于产品界面。和名单底下的操作栏一样在吸附那一档。 */
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

type Understanding = "on" | "off";

/** 首页的正文：产品的 `HomeScreen`，搜索方式由内存 router 地址上的 `mode` 决定。 */
function Home({ understanding }: { understanding: boolean }) {
	const asked = useRouterState({
		select: (state) => (state.location.search as { mode?: "keyword" }).mode,
	});
	return (
		<HomeScreen
			asked={asked}
			error={null}
			onQuery={() => true}
			understanding={understanding}
		/>
	);
}

/** 页底切换：AI 服务配没配。没配时只有关键词搜索，切回来时地址回到首页。 */
function UnderstandingSwitch({
	value,
	onChange,
}: {
	value: Understanding;
	onChange: (next: Understanding) => void;
}) {
	const navigate = useNavigate();
	return (
		<LayoutSwitch<Understanding>
			label="AI 服务"
			onChange={(next) => {
				onChange(next);
				void navigate({ search: {}, to: "/" });
			}}
			options={[
				{ label: "已配置 AI 服务", value: "on" },
				{ label: "未配置 AI 服务", value: "off" },
			]}
			value={value}
		/>
	);
}

/** 首页：导航栏右边的卡片里只有标题、两种搜索的切换和输入面。 */
export function HomePage() {
	const [understanding, setUnderstanding] = useState<Understanding>("on");
	return (
		<Routed url="/">
			<Shell>
				<Home understanding={understanding === "on"} />
			</Shell>
			<UnderstandingSwitch onChange={setUnderstanding} value={understanding} />
		</Routed>
	);
}
