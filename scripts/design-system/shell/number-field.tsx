import { RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Input } from "#/components/ui/input";
import { ModifiedMark } from "../shared/marks";

/** 显示最多三位小数；存的值不取整。 */
const shown = (value: number) => String(Number(value.toFixed(3)));

/**
 * 右栏里调一个数的框：左端的符号按住左右拖改值（Shift 十倍、Alt 十分之一），拖的过程中
 * 只预览（`onPreview` 给数，放弃时给 null），松手才记一步。中间可以直接输入，回车或离开时提交。
 */
export function NumberField({
	label,
	max,
	min,
	modified,
	onCommit,
	onPreview,
	onReset,
	step,
	symbol,
	token,
	unit,
	value,
}: {
	label: string;
	max: number;
	min: number;
	modified: boolean;
	onCommit: (value: number) => void;
	onPreview: (value: number | null) => void;
	/** 给了才在改过的项右端放还原按钮。 */
	onReset?: () => void;
	step: number;
	symbol: string;
	token: string;
	unit: string;
	value: number;
}) {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const dirty = useRef(false);
	const drag = useRef<{
		x: number;
		start: number;
		last: number;
		moved: boolean;
	} | null>(null);
	const [text, setText] = useState(shown(value));
	const [invalid, setInvalid] = useState(false);
	const clamp = (next: number) =>
		Number(Math.max(min, Math.min(max, next)).toFixed(3));
	const factor = (event: { shiftKey: boolean; altKey: boolean }) =>
		event.shiftKey ? 10 : event.altKey ? 0.1 : 1;

	useEffect(() => {
		dirty.current = false;
		setText(shown(value));
		setInvalid(false);
	}, [value]);

	/** 输入的数不改写：写不对或超出范围时不提交，框下说要什么样的数。 */
	const commitText = () => {
		if (!dirty.current) return;
		const next = Number(text.trim());
		if (!text.trim() || !Number.isFinite(next) || next < min || next > max) {
			setInvalid(true);
			return;
		}
		dirty.current = false;
		setInvalid(false);
		setText(String(next));
		onCommit(next);
	};
	/** 按键对应的新值：方向键按步长，Home / End 到两端；别的键返回 undefined。 */
	const keyed = (
		event: { key: string; shiftKey: boolean; altKey: boolean },
		keys: { up: string[]; down: string[] },
	) => {
		if (event.key === "Home") return min;
		if (event.key === "End") return max;
		const direction = keys.up.includes(event.key)
			? 1
			: keys.down.includes(event.key)
				? -1
				: 0;
		if (!direction) return undefined;
		return clamp(value + direction * step * factor(event));
	};
	const commitKeyed = (next: number) => {
		dirty.current = false;
		setText(String(next));
		setInvalid(false);
		onCommit(next);
	};
	const endDrag = () => {
		if (!drag.current) return;
		drag.current = null;
		onPreview(null);
	};

	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<label
				className="flex items-center gap-1.5 text-fg-secondary text-xs"
				htmlFor={id}
			>
				{label}
				{modified && <ModifiedMark />}
			</label>
			<Input
				aria-describedby={invalid ? `${id}-error` : undefined}
				aria-invalid={invalid || undefined}
				aria-label={label}
				aria-valuemax={max}
				aria-valuemin={min}
				aria-valuenow={value}
				aria-valuetext={`${shown(value)}${unit}`}
				id={id}
				inputMode="decimal"
				onBlur={commitText}
				onChange={(event) => {
					dirty.current = true;
					setText(event.target.value);
					setInvalid(false);
				}}
				onFocus={(event) => event.target.select()}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commitText();
						event.currentTarget.select();
					} else if (event.key === "Escape") {
						event.preventDefault();
						dirty.current = false;
						setText(shown(value));
						setInvalid(false);
						onPreview(null);
					} else {
						const next = keyed(event, {
							down: ["ArrowDown"],
							up: ["ArrowUp"],
						});
						if (next === undefined) return;
						event.preventDefault();
						commitKeyed(next);
					}
				}}
				prefix={
					<button
						aria-controls={id}
						aria-label={`调整${label}：左右拖动或按方向键`}
						className="w-4 cursor-ew-resize text-center font-mono text-fg-tertiary text-xs"
						onKeyDown={(event) => {
							if (event.key === "Escape") endDrag();
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								input.current?.focus();
								return;
							}
							const next = keyed(event, {
								down: ["ArrowDown", "ArrowLeft"],
								up: ["ArrowUp", "ArrowRight"],
							});
							if (next === undefined) return;
							event.preventDefault();
							commitKeyed(next);
						}}
						onLostPointerCapture={endDrag}
						onPointerCancel={endDrag}
						onPointerDown={(event) => {
							if (event.button !== 0) return;
							event.preventDefault();
							event.currentTarget.setPointerCapture(event.pointerId);
							drag.current = {
								last: value,
								moved: false,
								start: value,
								x: event.clientX,
							};
						}}
						onPointerMove={(event) => {
							const current = drag.current;
							if (!current) return;
							const delta = event.clientX - current.x;
							if (!current.moved && Math.abs(delta) < 3) return;
							current.moved = true;
							current.last = clamp(
								current.start + Math.round(delta / 2) * step * factor(event),
							);
							onPreview(current.last);
						}}
						onPointerUp={(event) => {
							const current = drag.current;
							if (!current) return;
							drag.current = null;
							event.currentTarget.releasePointerCapture(event.pointerId);
							if (current.moved) onCommit(current.last);
							else input.current?.focus();
						}}
						title={`${token}\n左右拖动或按方向键调整，按住 Shift 加快；点击后输入数值。`}
						type="button"
					>
						{symbol}
					</button>
				}
				ref={input}
				role="spinbutton"
				size="small"
				suffix={
					<span className="flex items-center gap-1 text-fg-tertiary text-xs">
						{unit}
						{modified && onReset && (
							<ActionIcon
								icon={RotateCcw}
								onClick={onReset}
								size="small"
								title={`还原${label}`}
							/>
						)}
					</span>
				}
				value={text}
				variant="filled"
			/>
			{invalid && (
				<span className="text-error text-xs" id={`${id}-error`}>
					请输入 {min}–{max} 之间的数值。
				</span>
			)}
		</div>
	);
}
