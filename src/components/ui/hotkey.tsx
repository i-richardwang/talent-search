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
 * 样式在 hotkey.css。`keys` 用 `+` 连起几个键名（`mod+k`）；修饰键按
 * ctrl、meta、mod、alt、shift 的先后排到前面，其余键保持写的先后。
 *
 * 修饰键、回车、退格、Tab 在苹果设备上画成符号（⌘ ⌥ ⇧ ⌃ 等），其余设备写 Ctrl、Alt、Shift
 * 这样的名字；方向键和空格两边都画成图标；其余键名首字母大写原样显示。
 *
 * 默认每个键一个键帽，键帽之间 2px。`compact` 或 `borderless` 时几个键收进同一个键帽，
 * 键与键之间 6px：提示里跟在文字后面的快捷键用 `compact`，夹在一句话里的用 `borderless`。
 *
 * 是不是苹果设备用 `useSyncExternalStore` 读 `navigator`，服务端快照取非苹果，
 * 服务端与浏览器首帧一致。
 */

export interface HotkeyProps {
	className?: string;
	/** 几个键收进同一个键帽。`borderless` 总是这样排。 */
	compact?: boolean;
	keys: string;
	/**
	 * `filled` 是浅灰底；`outlined` 是容器底加一圈描边，放在同样浅灰的面上；
	 * `borderless` 不画底，颜色跟着所在那句话（例如输入托盘的占位）。
	 */
	variant?: "filled" | "outlined" | "borderless";
}

const APPLE = /mac|iphone|ipod|ipad|ios/i;

/** 设备在一次会话里不变，没有要订阅的变化。 */
const subscribeNothing = () => () => {};

/**
 * 是不是苹果设备。服务端没有 `navigator`，快照取非苹果；水合时首帧与服务端一致，
 * 之后换成浏览器里的实际取值。
 */
function useIsAppleDevice() {
	return useSyncExternalStore(
		subscribeNothing,
		() => APPLE.test(navigator.userAgent),
		() => false,
	);
}

/** 修饰键的先后：Ctrl、Win/⌘、mod、Alt/⌥、Shift，与系统菜单里快捷键的写法一致。 */
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

export function Hotkey({
	className,
	compact,
	keys,
	variant = "filled",
}: HotkeyProps) {
	const keysGroup = useMemo(() => splitKeys(keys), [keys]);
	const isAppleDevice = useIsAppleDevice();
	const mapping = useMemo(() => mappingKey(isAppleDevice), [isAppleDevice]);
	const isBorderless = variant === "borderless";
	const kbdClassName = cn("ui-hotkey", `ui-hotkey-${variant}`);

	return (
		<Flexbox
			align="center"
			as="span"
			className={className}
			gap={isBorderless ? 6 : 2}
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
