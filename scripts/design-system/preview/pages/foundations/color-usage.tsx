import { ChevronDown, ListFilter } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Collapsible } from "#/components/ui/collapsible";
import { Input } from "#/components/ui/input";
import { Tabs } from "#/components/ui/tabs";
import { cn } from "#/lib/utils";
import { contrastRatio, parseColor, type Rgba } from "../../../shared/color";
import { tokenLabel } from "../../../shared/tokens/registry";
import { usePreviewState } from "../../state";
import { selectColor } from "./colors";

/** 每种用途用到哪几个颜色；点令牌名在右栏编辑它。 */
const MAPPINGS: [role: string, tokens: string[]][] = [
	["主要操作", ["--color-primary", "--color-primary-hover", "--color-layout"]],
	["次要操作", ["--color-container", "--color-fg", "--color-border"]],
	["菜单里的危险项", ["--color-error", "--color-error-bg"]],
	["激活的筛选", ["--color-fill-tertiary", "--color-fg"]],
	[
		"标签页 · 文字 / 指示",
		["--color-fg", "--color-fg-secondary", "--color-elevated"],
	],
	[
		"输入框 · 文字 / 边框",
		["--color-fg", "--color-fg-quaternary", "--color-border"],
	],
	["键盘焦点", ["--color-info"]],
	["输入错误", ["--color-error"]],
];

/** 「规则与测量说明」的两段：量什么、不量什么；颜色怎么分工。 */
const NOTES = [
	"文字对它身后的底要到 4.5:1；键盘聚焦时，画在控件外面的焦点框对控件外面的底要到 3:1。量的是浏览器算出来的颜色：从控件往外一层层叠底色，叠到第一层不透明的底为止，半透明的文字也先叠上去再量；过渡没走完不量，遇到渐变、背景图或整体透明度不报数。禁用的控件不计。占位文字、标签页的指示条、边框对底的对比、焦点框的粗细与位置不在这里量，这里也不是完整的无障碍检查。",
	"主色是单色，主要操作用主色的底；菜单里的危险项和输入错误用错误色；键盘焦点用信息色；选中与激活的筛选用填充底，不另加色相。色相只留给状态：绿色表示受控字段命中，琥珀色表示需要留意。改一个颜色会影响所有用到它的组件，导出前深浅两侧都看一遍。",
];

type State =
	| "default"
	| "hover"
	| "pressed"
	| "focus"
	| "selected"
	| "invalid"
	| "disabled";

const STATE_LABEL: Record<State, string> = {
	default: "默认",
	disabled: "禁用",
	focus: "聚焦",
	hover: "悬停",
	invalid: "错误",
	pressed: "按下",
	selected: "选中",
};

interface Reading {
	label: string;
	state: State;
	/** 文字对它身后的底。 */
	ratio?: number;
	/** 键盘焦点框对它外面的底。 */
	focusRatio?: number;
}

/**
 * 从一个元素往外逐层取底色，叠到第一层不透明的底为止，外层在前。遇到透明度以外的
 * 画法（渐变、图片、整体半透明）返回 undefined：不报一个可能错的数。
 */
function backgroundOf(start: HTMLElement | null): Rgba[] | undefined {
	const layers: Rgba[] = [];
	for (let node = start; node; node = node.parentElement) {
		const style = getComputedStyle(node);
		if (Number(style.opacity) !== 1 || style.backgroundImage !== "none")
			return undefined;
		const layer = parseColor(style.backgroundColor);
		if (!layer) return undefined;
		layers.unshift(layer);
		if (layer.a === 1) return layers;
	}
	return undefined;
}

/**
 * 量一个控件现在的对比度：文字色对它身后的底；键盘聚焦时，画在控件外面的焦点框
 * 对父元素身后的底。
 */
function readControl(element: HTMLElement): Reading {
	const disabled = element.matches(
		":disabled, [aria-disabled='true'], [data-disabled]",
	);
	const focus = element.matches(":focus-visible");
	const state: State = disabled
		? "disabled"
		: element.matches(":active")
			? "pressed"
			: focus
				? "focus"
				: element.matches(":hover")
					? "hover"
					: element.matches("[aria-invalid='true']")
						? "invalid"
						: element.matches("[aria-selected='true'], [aria-pressed='true']")
							? "selected"
							: "default";
	const reading: Reading = { label: element.dataset.colorProbe ?? "", state };
	if (
		disabled ||
		element
			.getAnimations()
			.some((animation) => animation.playState === "running")
	)
		return reading;
	const style = getComputedStyle(element);
	const inside = backgroundOf(element);
	const text = parseColor(style.color);
	if (inside && text) reading.ratio = contrastRatio(text, inside);
	const outside = backgroundOf(element.parentElement);
	const outline = parseColor(style.outlineColor);
	if (focus && outside && outline && style.outlineStyle !== "none")
		reading.focusRatio = contrastRatio(outline, outside);
	return reading;
}

const verdict = (ratio: number | undefined, minimum: number) =>
	ratio === undefined
		? "未测量"
		: `${ratio.toFixed(2)}:1 · ${ratio >= minimum ? "通过" : "未通过"}`;

/** 一块示例：里面带 `data-color-probe` 的控件随交互重新量，量出来的数列在下面。 */
function MeasuredSample({
	children,
	revision,
	title,
}: {
	children: ReactNode;
	revision: string;
	title: string;
}) {
	const root = useRef<HTMLDivElement>(null);
	const [readings, setReadings] = useState<Reading[]>([]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 修改版和深浅改的是页面级样式，这块元素上没有属性变化，靠 revision 触发重新量
	useEffect(() => {
		const node = root.current;
		if (!node) return;
		let frame = 0;
		let timer = 0;
		const read = () => {
			const next = [
				...node.querySelectorAll<HTMLElement>("[data-color-probe]"),
			].map(readControl);
			setReadings((previous) =>
				JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
			);
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			window.clearTimeout(timer);
			frame = requestAnimationFrame(read);
			timer = window.setTimeout(read, 250);
		};
		const events = [
			"pointerover",
			"pointerout",
			"pointerdown",
			"pointerup",
			"focusin",
			"focusout",
			"keyup",
			"input",
			"transitionend",
		];
		for (const event of events) node.addEventListener(event, schedule);
		window.addEventListener("pointerup", schedule);
		const observer = new MutationObserver(schedule);
		observer.observe(node, {
			attributeFilter: [
				"disabled",
				"aria-disabled",
				"aria-invalid",
				"aria-selected",
				"aria-pressed",
				"data-active",
				"class",
			],
			attributes: true,
			subtree: true,
		});
		schedule();
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
			window.clearTimeout(timer);
			for (const event of events) node.removeEventListener(event, schedule);
			window.removeEventListener("pointerup", schedule);
		};
	}, [revision]);
	return (
		<Block className="min-w-0" gap={0} variant="outlined">
			<h3 className="px-5 pt-4 font-medium text-sm">{title}</h3>
			<div
				className="flex flex-wrap items-center gap-3 bg-container px-5 py-5"
				ref={root}
			>
				{children}
			</div>
			<ul className="flex flex-col border-border-secondary border-t px-5 py-3 text-xs">
				{readings.map((reading) => (
					<li
						className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1"
						key={reading.label}
					>
						<strong className="font-medium">{reading.label}</strong>
						<span className="text-fg-tertiary">
							{STATE_LABEL[reading.state]}
						</span>
						<output
							className={
								reading.ratio === undefined
									? "ml-auto text-fg-tertiary"
									: reading.ratio >= 4.5
										? "ml-auto text-success"
										: "ml-auto text-error"
							}
						>
							{reading.state === "disabled"
								? "禁用不计"
								: `文字 ${verdict(reading.ratio, 4.5)}`}
						</output>
						{reading.focusRatio !== undefined && (
							<output
								className={
									reading.focusRatio >= 3
										? "w-full text-success"
										: "w-full text-error"
								}
							>
								焦点框 {verdict(reading.focusRatio, 3)}
							</output>
						)}
					</li>
				))}
			</ul>
		</Block>
	);
}

/**
 * 用途与对比度：每种用途用到的颜色，以及几种真实控件在各个状态下量出来的对比度。
 * 文字按 WCAG 1.4.3 要 4.5:1，焦点框按 1.4.11 要 3:1；禁用的控件不计。
 */
export function ColorUsage() {
	const { draft, theme } = usePreviewState();
	const [disabled, setDisabled] = useState(false);
	const [invalid, setInvalid] = useState(false);
	const [filtered, setFiltered] = useState(true);
	const [notes, setNotes] = useState(false);
	const notesId = useId();
	const revision = JSON.stringify([draft, theme, disabled, invalid, filtered]);
	return (
		<div className="flex flex-col gap-8 pt-4">
			<section>
				<h2 className="mb-3.5 font-semibold text-base">用途</h2>
				<Block gap={0} variant="outlined">
					{MAPPINGS.map(([role, tokens]) => (
						<div
							className="flex flex-wrap items-center gap-3 border-border-secondary border-b px-4 py-2.5 text-xs last:border-b-0"
							key={role}
						>
							<span className="w-40 text-fg-secondary">{role}</span>
							<div className="flex flex-wrap gap-1.5">
								{tokens.map((token) => (
									<Button
										key={token}
										onClick={() => selectColor(token)}
										size="small"
										title={`编辑${tokenLabel(token)}`}
										type="fill"
									>
										<code>{token}</code>
									</Button>
								))}
							</div>
						</div>
					))}
				</Block>
			</section>
			<section>
				<div className="mb-2 flex items-center justify-between gap-3">
					<h2 className="font-semibold text-base">交互状态</h2>
					<Checkbox checked={disabled} onChange={setDisabled}>
						禁用
					</Checkbox>
				</div>
				<p className="mb-4 text-fg-tertiary text-xs">
					悬停、按住鼠标或用 Tab
					聚焦，下面的数跟着重新量。点上面的令牌名可以调整颜色。
				</p>
				<div className="grid grid-cols-3 gap-3.5 max-lg:grid-cols-2 max-md:grid-cols-1">
					<MeasuredSample revision={revision} title="按钮">
						<Button
							data-color-probe="主要操作"
							disabled={disabled}
							type="primary"
						>
							新建搜索
						</Button>
						<Button data-color-probe="次要操作" disabled={disabled}>
							取消
						</Button>
						<Button
							aria-pressed={filtered}
							data-color-probe="激活的筛选"
							disabled={disabled}
							icon={ListFilter}
							onClick={() => setFiltered(!filtered)}
							type={filtered ? "fill" : "default"}
						>
							筛选
							{filtered && <span className="tabular-nums">1</span>}
						</Button>
					</MeasuredSample>
					<MeasuredSample revision={revision} title="标签页">
						<Tabs
							items={[
								{
									disabled,
									key: "resume",
									label: <span data-color-probe="简历">简历</span>,
								},
								{
									disabled,
									key: "evidence",
									label: <span data-color-probe="证据">证据</span>,
								},
							]}
						/>
					</MeasuredSample>
					<MeasuredSample revision={revision} title="输入框">
						<div className="flex w-full flex-col gap-3">
							<Input
								aria-invalid={invalid || undefined}
								aria-label="需求"
								data-color-probe="需求"
								defaultValue="五年以上后端经验"
								disabled={disabled}
							/>
							<Checkbox checked={invalid} onChange={setInvalid}>
								错误
							</Checkbox>
						</div>
					</MeasuredSample>
				</div>
			</section>
			<section className="border-border-secondary border-t pt-3">
				<Button
					aria-controls={notesId}
					aria-expanded={notes}
					onClick={() => setNotes(!notes)}
					size="small"
					type="text"
				>
					规则与测量说明
					<ChevronDown
						className={cn(
							"size-3 transition-transform",
							!notes && "-rotate-90",
						)}
					/>
				</Button>
				<Collapsible id={notesId} open={notes}>
					<div className="flex max-w-3xl flex-col gap-2 px-2 pt-2 text-fg-secondary text-xs leading-5">
						{NOTES.map((note) => (
							<p key={note}>{note}</p>
						))}
						<p>
							<a
								href="https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html"
								rel="noreferrer"
								target="_blank"
							>
								WCAG 1.4.3 文字对比度
							</a>
							{" · "}
							<a
								href="https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html"
								rel="noreferrer"
								target="_blank"
							>
								WCAG 1.4.11 非文字对比度
							</a>
						</p>
					</div>
				</Collapsible>
			</section>
		</div>
	);
}
