import { Text } from "@cloudflare/kumo";
import { createFileRoute } from "@tanstack/react-router";
import { StrengthLegend } from "../../-components/evidence";

const KEYS = [
	["↑↓", "切换员工"],
	["/", "添加条件"],
	["Esc", "关闭详情"],
] as const;

/**
 * `/` 的详情栏。
 *
 * 详情栏画哪一份内容由 URL 决定，那正是路由的事：`/s/:turnId` 是这一份，
 * `/s/:turnId/p/:empId` 是那个人的时间线，工号不在库里是 `p.$empId.tsx`
 * 自己的 `notFoundComponent`。
 * 外壳只管无条件渲染 `<Outlet />`，不在自己身上写「有没有选人」的分支。
 */
export const Route = createFileRoute("/s/$turnId/")({
	component: DetailEmpty,
});

/**
 * 三栏工作台里这一栏是常驻的，所以「空」是一个会被反复看到的状态，
 * 不能只放一句「选一个人」。放图例：点阵是这套界面唯一需要学习的编码，
 * 而这里正好是那块一直空着、又一直在视野里的地方。学会之后它就退成背景，
 * 因为一旦选中了人，这块就被真正的证据占满了。
 */
function DetailEmpty() {
	return (
		<div className="flex h-full flex-col">
			{/*
			 * 和选中一个人之后那一栏（`p.$empId.tsx`）用同一条 56px 的头。
			 * 差一条边框、差十几像素的起始高度，换人 / 取消选中时这一栏的顶部
			 * 就会跳一下，而它是常驻栏，这个跳是会被反复看到的。
			 */}
			<div className="flex h-14 shrink-0 items-center border-kumo-hairline border-b px-4">
				<Text as="h2" bold size="sm" variant="secondary">
					匹配来源
				</Text>
			</div>

			<div className="flex flex-1 flex-col justify-between gap-8 px-4 py-4">
				<div>
					<StrengthLegend />
					<p className="read-cjk mt-5 border-kumo-hairline border-t pt-4 text-kumo-subtle text-sm">
						选择一名员工后，可查看各项条件的匹配来源和任职经历。
					</p>
				</div>

				<ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
					{KEYS.map(([key, what]) => (
						<li
							className="flex items-center gap-1.5 text-kumo-subtle text-xs"
							key={key}
						>
							<kbd className="rounded-control bg-kumo-tint px-1.5 py-0.5 font-mono">
								{key}
							</kbd>
							{what}
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
