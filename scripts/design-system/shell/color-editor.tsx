import { Check, Copy, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { ActionIcon } from "#/components/ui/action-icon";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Input } from "#/components/ui/input";
import {
	formatColor,
	fromOklch,
	inSrgb,
	type Oklch,
	parseColor,
	type Rgba,
	toHex,
	toOklch,
} from "../shared/color";
import { Swatch } from "../shared/marks";
import { NumberField } from "./number-field";

const PRESETS = [
	"#FFFFFF",
	"#080808",
	"#666666",
	"#0072F5",
	"#7C3AED",
	"#DB2777",
	"#EC5E41",
	"#EE9E0B",
	"#379D4A",
];

/**
 * 调一个颜色：色板、HEX、不透明度、修改前后的对比、快捷色，以及按 OKLCH 精确调整。
 * 拖色板和拖数值时只预览，松手才提交。颜色存成 sRGB；OKLCH 调到 sRGB 以外时，
 * 超出的通道截到边界，并提示这一点。
 */
export function ColorEditor({
	onCommit,
	onPreview,
	original,
	token,
	value,
}: {
	onCommit: (value: string) => void;
	/** 拖动中的颜色；放弃时是 null。 */
	onPreview: (value: string | null) => void;
	/** 源文件里的值（修改前）。 */
	original: string;
	token: string;
	value: string;
}) {
	const errorId = useId();
	const color = parseColor(value) ?? { a: 1, b: 0, g: 0, r: 0 };
	const base = parseColor(original) ?? color;
	const hex = toHex(color);
	const modified = formatColor(color) !== formatColor(base);
	const [hexInput, setHexInput] = useState(hex);
	const [invalid, setInvalid] = useState(false);
	const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);
	/** 最近一次按 OKLCH 调出的颜色超出 sRGB，存下来的是截过的颜色。 */
	const [clipped, setClipped] = useState(false);
	const [precise, setPrecise] = useState(false);
	const hexDirty = useRef(false);
	const picked = useRef<Rgba | undefined>(undefined);
	const oklch = toOklch(color);

	useEffect(() => {
		hexDirty.current = false;
		setHexInput(hex);
		setInvalid(false);
	}, [hex]);
	useEffect(() => {
		if (!copyState) return;
		const timer = window.setTimeout(() => setCopyState(null), 2000);
		return () => window.clearTimeout(timer);
	}, [copyState]);

	/** 不经 OKLCH 的改动：提交后不再有截过的颜色。 */
	const commit = (next: string) => {
		setClipped(false);
		onCommit(next);
	};
	const fromChannel = (channel: keyof Oklch, next: number) => {
		const target = { ...oklch, [channel]: next };
		setClipped(!inSrgb(target));
		return formatColor(fromOklch(target, color.a));
	};

	const withAlpha = (next: Rgba, alpha = color.a) =>
		formatColor({ ...next, a: alpha });
	const fromHex = (text: string) => {
		const parsed = parseColor(text.startsWith("#") ? text : `#${text}`);
		return parsed && parsed.a === 1 ? parsed : undefined;
	};
	/** 色板上拖动或按方向键时只预览，松开时提交最后一次选中的颜色。 */
	function commitPicked() {
		if (!picked.current) return;
		commit(withAlpha(picked.current));
		picked.current = undefined;
	}
	const commitHex = () => {
		if (!hexDirty.current) return;
		const parsed = fromHex(hexInput.trim());
		if (!parsed) {
			setInvalid(true);
			return;
		}
		hexDirty.current = false;
		if (toHex(parsed) !== hex) commit(withAlpha(parsed));
		else setHexInput(hex);
	};

	return (
		<div className="flex flex-col gap-3.5">
			<HexColorPicker
				className="h-40! w-full!"
				color={hex}
				onChange={(next) => {
					picked.current = fromHex(next);
					if (picked.current) onPreview(withAlpha(picked.current));
				}}
				onKeyUp={commitPicked}
				onPointerUp={commitPicked}
			/>
			<div className="flex items-center gap-2">
				<Input
					aria-describedby={invalid ? errorId : undefined}
					aria-invalid={invalid || undefined}
					aria-label="HEX 色值"
					className="flex-1"
					maxLength={7}
					onBlur={commitHex}
					onChange={(event) => {
						hexDirty.current = true;
						setHexInput(event.target.value);
						setInvalid(false);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commitHex();
						}
						if (event.key === "Escape") {
							hexDirty.current = false;
							setHexInput(hex);
							setInvalid(false);
						}
					}}
					prefix={<span className="text-fg-tertiary text-xs">HEX</span>}
					spellCheck={false}
					value={hexInput}
				/>
				<ActionIcon
					icon={copyState === "copied" ? Check : Copy}
					onClick={() =>
						navigator.clipboard.writeText(hex).then(
							() => setCopyState("copied"),
							() => setCopyState("failed"),
						)
					}
					aria-label="复制 HEX 色值"
					size="small"
					title="复制 HEX 色值"
				/>
			</div>
			{invalid && (
				<p className="text-error text-xs" id={errorId} role="alert">
					请输入 3 位或 6 位 HEX 色值。
				</p>
			)}
			{copyState && (
				<p className="text-fg-secondary text-xs" role="status">
					{copyState === "copied"
						? "已复制色值。"
						: "无法复制，请选中色值后手动复制。"}
				</p>
			)}
			{clipped && (
				<p className="text-warning text-xs" role="status">
					超出 sRGB，超出的通道已截到边界。
				</p>
			)}
			<NumberField
				label="不透明度"
				max={100}
				min={0}
				modified={Math.abs(color.a - base.a) >= 0.001}
				onCommit={(next) => commit(withAlpha(color, next / 100))}
				onPreview={(next) =>
					onPreview(next === null ? null : withAlpha(color, next / 100))
				}
				onReset={() => commit(withAlpha(color, base.a))}
				step={1}
				symbol="A"
				token={token}
				unit="%"
				value={Number((color.a * 100).toFixed(1))}
			/>
			<div className="flex items-center gap-3">
				<span className="flex flex-1 items-center gap-2 text-fg-secondary text-xs">
					<Swatch color={original} />
					修改前
				</span>
				<span className="flex flex-1 items-center gap-2 text-fg-secondary text-xs">
					<Swatch color={value} />
					修改后
				</span>
				<ActionIcon
					disabled={!modified}
					icon={RotateCcw}
					onClick={() => commit(formatColor(base))}
					aria-label="还原"
					size="small"
					title="还原"
				/>
			</div>
			<div className="flex flex-col gap-2">
				<span className="flex items-center text-fg-secondary text-xs">
					快捷色
					<span className="ml-auto font-mono text-fg-tertiary">sRGB</span>
				</span>
				<div className="flex justify-between">
					{PRESETS.map((preset) => (
						<button
							aria-label={`使用 ${preset}`}
							aria-pressed={hex === preset}
							className="size-5 rounded-full border border-border aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-offset-1"
							key={preset}
							onClick={() => {
								const parsed = fromHex(preset);
								if (parsed) commit(withAlpha(parsed));
							}}
							style={{ background: preset }}
							title={preset}
							type="button"
						/>
					))}
				</div>
			</div>
			<div className="border-border-secondary border-t pt-3">
				<CollapsibleTrigger
					className="w-full text-fg-secondary text-xs"
					onOpenChange={setPrecise}
					open={precise}
					panelId={`${errorId}-oklch`}
				>
					精确调整
					<span className="ml-auto font-mono text-fg-tertiary">OKLCH</span>
				</CollapsibleTrigger>
				<Collapsible id={`${errorId}-oklch`} open={precise}>
					<div className="grid grid-cols-3 gap-2 pt-3">
						{(
							[
								["l", "明度", 1, 0.005],
								["c", "彩度", 0.4, 0.005],
								["h", "色相", 360, 1],
							] as const
						).map(([channel, name, max, step]) => (
							<NumberField
								key={channel}
								label={name}
								max={max}
								min={0}
								modified={false}
								onCommit={(next) => onCommit(fromChannel(channel, next))}
								onPreview={(next) => {
									if (next !== null) onPreview(fromChannel(channel, next));
									else {
										setClipped(false);
										onPreview(null);
									}
								}}
								step={step}
								symbol={channel.toUpperCase()}
								token={token}
								unit=""
								value={oklch[channel]}
							/>
						))}
					</div>
					<code className="mt-2 block break-all text-fg-tertiary text-xs">
						{value}
					</code>
				</Collapsible>
			</div>
		</div>
	);
}
