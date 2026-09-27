import {
	ArrowDownIcon,
	ArrowUpIcon,
	Command,
	CornerDownLeftIcon,
	SpaceIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { cn } from "#/lib/utils";
import { Center, Flexbox } from "./flex";
import { Icon } from "./icon";

/*
 * 样式在 hotkey.css。`keys` 用 `+` 连起几个键名（`mod+k`），按写的先后显示；
 * 每个键一个 `<kbd>` 键帽。
 * mod、enter 在苹果设备上画成 ⌘ 和回车图标，其余设备写 Ctrl、Enter；方向键和空格画成图标；
 * 其余键名首字母大写原样显示。
 *
 * 是不是苹果设备用 `useSyncExternalStore` 读 `navigator`，服务端快照取非苹果，
 * 服务端与浏览器首帧一致。
 */

interface HotkeyProps {
	keys: string;
	/** `borderless` 用在一句话里（例如输入托盘的占位）：键帽不画底，颜色跟着那句话。 */
	variant?: "filled" | "borderless";
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

const mappingKey = (isAppleDevice: boolean): Record<string, ReactNode> => ({
	down: <Icon icon={ArrowDownIcon} />,
	enter: isAppleDevice ? <Icon icon={CornerDownLeftIcon} /> : "Enter",
	mod: isAppleDevice ? (
		<Icon icon={Command} size={{ size: "0.95em" }} />
	) : (
		"Ctrl"
	),
	space: <Icon icon={SpaceIcon} />,
	up: <Icon icon={ArrowUpIcon} />,
});

const startCase = (str: string): string =>
	str.replace(/^./, (s) => s.toUpperCase());

export function Hotkey({ keys, variant = "filled" }: HotkeyProps) {
	const keysGroup = useMemo(() => keys.split("+"), [keys]);
	const isAppleDevice = useIsAppleDevice();
	const mapping = useMemo(() => mappingKey(isAppleDevice), [isAppleDevice]);

	return (
		<Flexbox align="center" gap={2} horizontal>
			{keysGroup.map((key, index) => (
				<Center
					as="kbd"
					className={cn(
						"ui-hotkey",
						variant === "borderless" && "ui-hotkey-borderless",
					)}
					// biome-ignore lint/suspicious/noArrayIndexKey: 同一个键名可以出现两次，位置就是身份
					key={index}
				>
					{mapping[key] ?? startCase(key)}
				</Center>
			))}
		</Flexbox>
	);
}
