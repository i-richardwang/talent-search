import { useEffect, useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Drawer } from "#/components/ui/drawer";
import { Input } from "#/components/ui/input";
import { Modal } from "#/components/ui/modal";
import { Segmented } from "#/components/ui/segmented";
import { tokenValue } from "../../../shared/source";
import {
	EASING_TOKENS,
	EASINGS,
	numericTokens,
	type Overlay,
} from "../../../shared/tokens/registry";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Stage } from "../../kit/stage";
import { useMotionCommands } from "../../motion";
import { usePreviewState, useTokenNumber } from "../../state";

/** `cubic-bezier(a, b, c, d)` 画成一条曲线；`linear` 是一条直线。 */
function Curve({ value }: { value: string }) {
	const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] =
		/cubic-bezier\(([^)]+)\)/
			.exec(value)?.[1]
			?.split(",")
			.map(Number.parseFloat) ?? [];
	return (
		<svg className="h-20 w-32 overflow-visible text-fg" viewBox="0 0 100 60">
			<title>{value}</title>
			<path
				className="text-border"
				d="M0 60 L100 0"
				fill="none"
				stroke="currentColor"
				strokeDasharray="3 3"
			/>
			<path
				d={`M0 60 C${x1 * 100} ${60 - y1 * 60} ${x2 * 100} ${60 - y2 * 60} 100 0`}
				fill="none"
				stroke="currentColor"
				strokeWidth={2}
			/>
		</svg>
	);
}

/**
 * 动效页：缓动曲线，以及对话框、抽屉真实的进出场。外壳的工具条发来打开、关闭、
 * 重播；速度也在外壳里选。台脚写这个示例现在的进场、退场时长令牌。
 */
export function MotionPage() {
	const { draft } = usePreviewState();
	const read = useTokenNumber();
	const [example, setExample] = useState<Overlay>("modal");
	const [open, setOpen] = useState(false);
	const [reduced, setReduced] = useState(false);
	const afterClose = useMotionCommands(open, setOpen);

	useEffect(() => {
		const query = matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => setReduced(query.matches);
		sync();
		query.addEventListener("change", sync);
		return () => query.removeEventListener("change", sync);
	}, []);

	const duration = (phase: "enter" | "exit") =>
		read(`--duration-${example}-${phase}`);

	const content = (
		<div className="flex flex-col gap-3">
			<p className="text-fg-secondary text-sm">
				把这一轮的搜索条件存成模板，下次直接套用。
			</p>
			<Input aria-label="模板名称" defaultValue="支付风控 · 后端" />
		</div>
	);

	return (
		<DocPage
			facts={[
				`${EASING_TOKENS.length} 条缓动`,
				`${numericTokens("motion").length} 个时长`,
				"对话框与抽屉",
			]}
			sections={[
				{
					children: (
						<div className="flex flex-col gap-4">
							{reduced && (
								<p className="text-fg-secondary text-xs" role="status">
									系统开启了「减少动态效果」，组件的动画已经关闭。
								</p>
							)}
							<Controls>
								<Control label="示例">
									<Segmented<Overlay>
										onChange={(next) => {
											setOpen(false);
											setExample(next);
										}}
										options={[
											{ label: "对话框", value: "modal" },
											{ label: "抽屉", value: "drawer" },
										]}
										value={example}
									/>
								</Control>
							</Controls>
							<Stage
								footer={
									<>
										<span>进场 {duration("enter")} ms</span>
										<span>退场 {duration("exit")} ms</span>
									</>
								}
							>
								<Button onClick={() => setOpen(true)} type="primary">
									{example === "modal" ? "打开对话框" : "打开抽屉"}
								</Button>
								<p className="text-fg-tertiary text-xs" role="status">
									{open ? "已打开" : "已关闭"}
								</p>
							</Stage>
							{example === "modal" ? (
								<Modal
									afterClose={afterClose}
									onCancel={() => setOpen(false)}
									onOk={() => setOpen(false)}
									open={open}
									title="保存为模板"
								>
									{content}
								</Modal>
							) : (
								<Drawer
									afterClose={afterClose}
									onClose={() => setOpen(false)}
									open={open}
									title="保存为模板"
								>
									{content}
								</Drawer>
							)}
						</div>
					),
					id: "playback",
					title: "进出场",
				},
				{
					children: (
						<div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
							{EASING_TOKENS.map(({ key, label }) => {
								const value = tokenValue(draft, "shared", key);
								return (
									<Block
										align="center"
										gap={20}
										horizontal
										key={key}
										padding={20}
										variant="outlined"
									>
										<Curve value={value} />
										<div className="flex min-w-0 flex-col gap-0.5 text-xs">
											<span className="font-medium">{label}</span>
											<code className="text-fg-tertiary">{key}</code>
											<span className="text-fg-tertiary">
												{EASINGS.find(([easing]) => easing === value)?.[1]} ·{" "}
												{value}
											</span>
										</div>
									</Block>
								);
							})}
						</div>
					),
					id: "easing",
					title: "缓动",
				},
			]}
		/>
	);
}
