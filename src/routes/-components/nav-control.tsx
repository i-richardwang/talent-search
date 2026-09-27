import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { createContext, useContext, useEffect } from "react";
import { ActionIcon } from "#/components/ui/action-icon";

/*
 * 外壳交给各屏的导航栏控制（`AppShell` 提供）：页头用它打开窄屏的导航抽屉、展开收起
 * 宽屏的导航栏。导航栏里的内容和页头都读它，所以单放一处，不和外壳互相引用。
 */

/** 收起、展开导航栏的快捷键：提示里画的键帽和 `useNavHotkey` 认的键是同一组。 */
const TOGGLE_NAV_KEYS = "mod+[";

export interface NavControl {
	/** 窄屏上打开导航抽屉 */
	openDrawer: () => void;
	/** 宽屏上导航栏展开着 */
	expanded: boolean;
	toggle: () => void;
}

export const NavControlContext = createContext<NavControl | null>(null);
/** 导航的内容画在抽屉里：抽屉自己能关，里面不放收起导航栏的开关。 */
export const InDrawer = createContext(false);

/** 在整页上认 ⌘/Ctrl + [，收起或展开宽屏的导航栏；lg 以下导航栏在抽屉里，不认。 */
export function useNavHotkey(toggle: () => void) {
	useEffect(() => {
		const apple = /mac|iphone|ipod|ipad|ios/i.test(navigator.userAgent);
		const onKeyDown = (event: KeyboardEvent) => {
			const mod = apple ? event.metaKey : event.ctrlKey;
			if (!mod || event.shiftKey || event.altKey) return;
			if (event.code !== "BracketLeft") return;
			if (!matchMedia("(width >= 64rem)").matches) return;
			event.preventDefault();
			toggle();
		};
		addEventListener("keydown", onKeyDown);
		return () => removeEventListener("keydown", onKeyDown);
	}, [toggle]);
}

export function useNavControl() {
	return useContext(NavControlContext);
}

/**
 * 收起或展开宽屏导航栏的开关（页头尺寸的图标按钮），提示里带快捷键。
 * 放在导航栏顶上时平时藏着、指针进入导航栏才出现（`AppNavHeader` 的 `toggle`）；
 * 导航栏收起后由主栏页头的左端放一个。画在抽屉里时不出现。
 */
export function ToggleNavButton({ className }: { className?: string }) {
	const control = useNavControl();
	const inDrawer = useContext(InDrawer);
	if (!control || inDrawer) return null;
	const label = control.expanded ? "收起导航栏" : "展开导航栏";
	return (
		<ActionIcon
			aria-label={label}
			className={className}
			icon={control.expanded ? PanelLeftCloseIcon : PanelLeftOpenIcon}
			onClick={control.toggle}
			size="header"
			title={label}
			tooltipProps={{ hotkey: TOGGLE_NAV_KEYS, placement: "bottom" }}
		/>
	);
}
