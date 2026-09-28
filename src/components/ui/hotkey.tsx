import {
	ArrowBigUpIcon,
	ArrowDownIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowRightToLineIcon,
	ArrowUpIcon,
	ChevronUpIcon,
	Command,
	CornerDownLeftIcon,
	Delete,
	Grid2X2Icon,
	Option,
	SpaceIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { cn } from "#/lib/utils";
import { Center, Flexbox } from "./flex";
import { Icon } from "./icon";

/*
 * `keys` 用 `+` 连起几个键名（`mod+k`）。修饰键、回车、退格、Tab 在苹果设备上画成符号，
 * 其余设备写名字；方向键和空格两边都画成图标。
 */

export interface HotkeyProps {
	className?: string;
	/** 几个键收进同一个键帽：提示里跟在文字后面的用它。`borderless` 总是这样排。 */
	compact?: boolean;
	keys: string;
	/** `large` 是快捷键列表里那一档。 */
	size?: "middle" | "large";
	/** `borderless` 夹在一句话里，颜色跟着那句话。 */
	variant?: "filled" | "borderless";
}

const APPLE = /mac|iphone|ipod|ipad|ios/i;

/** 设备在一次会话里不变，没有要订阅的变化。 */
const subscribeNothing = () => () => {};

/** 服务端没有 `navigator`，快照取非苹果，水合时首帧与服务端相同。 */
function useIsAppleDevice() {
	return useSyncExternalStore(
		subscribeNothing,
		() => APPLE.test(navigator.userAgent),
		() => false,
	);
}

/** 修饰键的先后，照系统菜单里快捷键的写法。 */
const MODIFIER_ORDER = ["ctrl", "control", "meta", "mod", "alt", "shift"];

const modifierRank = (key: string) => {
	const rank = MODIFIER_ORDER.indexOf(key.toLowerCase());
	return rank === -1 ? MODIFIER_ORDER.length : rank;
};

/** 拆成键名并把修饰键排到前面；sort 是稳定的，其余键保持写的先后。 */
const splitKeys = (keys: string) =>
	keys.split("+").sort((a, b) => modifierRank(a) - modifierRank(b));

const mappingKey = (isAppleDevice: boolean): Record<string, ReactNode> => ({
	alt: isAppleDevice ? <Icon icon={Option} size={{ size: "0.95em" }} /> : "Alt",
	backspace: isAppleDevice ? <Icon icon={Delete} /> : "Backspace",
	control: isAppleDevice ? <Icon icon={ChevronUpIcon} /> : "Ctrl",
	ctrl: isAppleDevice ? <Icon icon={ChevronUpIcon} /> : "Ctrl",
	down: <Icon icon={ArrowDownIcon} />,
	enter: isAppleDevice ? <Icon icon={CornerDownLeftIcon} /> : "Enter",
	left: <Icon icon={ArrowLeftIcon} />,
	meta: isAppleDevice ? (
		<Icon icon={Command} size={{ size: "0.95em" }} />
	) : (
		<Icon icon={Grid2X2Icon} />
	),
	mod: isAppleDevice ? (
		<Icon icon={Command} size={{ size: "0.95em" }} />
	) : (
		"Ctrl"
	),
	right: <Icon icon={ArrowRightIcon} />,
	shift: isAppleDevice ? (
		<Icon icon={ArrowBigUpIcon} size={{ size: "1.15em" }} />
	) : (
		"Shift"
	),
	space: <Icon icon={SpaceIcon} />,
	tab: isAppleDevice ? <Icon icon={ArrowRightToLineIcon} /> : "Tab",
	up: <Icon icon={ArrowUpIcon} />,
});

const startCase = (str: string): string =>
	str.replace(/^./, (s) => s.toUpperCase());

/**
 * 键盘事件是不是按下了 `keys` 这组键：mod 在苹果设备上是 ⌘、其余设备是 Ctrl，
 * 其余修饰键（shift、alt）写了才要求按下，末一个键名不分大小写。
 */
export function matchesHotkey(event: KeyboardEvent, keys: string): boolean {
	const parts = keys.toLowerCase().split("+");
	const key = parts.at(-1);
	const apple = APPLE.test(navigator.userAgent);
	const mod = parts.includes("mod");
	return (
		event.key.toLowerCase() === key &&
		(apple ? event.metaKey : event.ctrlKey) === mod &&
		(apple ? !event.ctrlKey : !event.metaKey) &&
		event.shiftKey === parts.includes("shift") &&
		event.altKey === parts.includes("alt")
	);
}

export function Hotkey({
	className,
	compact,
	keys,
	size = "middle",
	variant = "filled",
}: HotkeyProps) {
	const keysGroup = useMemo(() => splitKeys(keys), [keys]);
	const isAppleDevice = useIsAppleDevice();
	const mapping = useMemo(() => mappingKey(isAppleDevice), [isAppleDevice]);
	const isBorderless = variant === "borderless";
	const large = size === "large";
	const kbdClassName = cn(
		"ui-hotkey",
		`ui-hotkey-${variant}`,
		large && "ui-hotkey-large",
	);

	return (
		<Flexbox
			align="center"
			as="span"
			className={cn(large && "ui-hotkey-group-large", className)}
			gap={isBorderless ? 6 : large ? 4 : 2}
			horizontal
		>
			{compact || isBorderless ? (
				<Center as="kbd" className={kbdClassName} gap={6} horizontal>
					{keysGroup.map((key, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: 同一个键名可以出现两次，位置就是身份
						<span key={index}>{mapping[key] ?? startCase(key)}</span>
					))}
				</Center>
			) : (
				keysGroup.map((key, index) => (
					<Center
						as="kbd"
						className={kbdClassName}
						// biome-ignore lint/suspicious/noArrayIndexKey: 同一个键名可以出现两次，位置就是身份
						key={index}
					>
						{mapping[key] ?? startCase(key)}
					</Center>
				))
			)}
		</Flexbox>
	);
}
