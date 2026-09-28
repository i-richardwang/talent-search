import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import {
	createContext,
	useContext,
	useEffect,
	useSyncExternalStore,
} from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { AppNavDrawerClose } from "#/components/ui/app-layout";
import type { NavPrefs } from "../-lib/nav-prefs";

/*
 * 外壳交给各屏的导航栏控制（`AppShell` 提供）。页头和导航栏的内容都读它，单放一处，
 * 不和外壳互相引用。
 */

/** 收起、展开导航栏的快捷键，画在提示里；`useNavHotkey` 认的是同一组键。 */
const TOGGLE_NAV_KEYS = "mod+[";

/** 导航栏常驻的宽度：lg 以上。以下导航栏收进抽屉。 */
const DOCKED_NAV = "(width >= 64rem)";

const subscribeDocked = (onChange: () => void) => {
	const list = matchMedia(DOCKED_NAV);
	list.addEventListener("change", onChange);
	return () => list.removeEventListener("change", onChange);
};

/** 导航栏此刻是不是常驻的（lg 以上）；服务端直出时算不是。 */
export function useNavDocked() {
	return useSyncExternalStore(
		subscribeDocked,
		() => matchMedia(DOCKED_NAV).matches,
		() => false,
	);
}

export interface NavControl {
	/** 窄屏上打开导航抽屉 */
	openDrawer: () => void;
	/** 宽屏上导航栏展开着 */
	expanded: boolean;
	toggle: () => void;
	prefs: NavPrefs;
	setPrefs: (patch: Partial<NavPrefs>) => void;
	openAllRecents: () => void;
}

export const NavControlContext = createContext<NavControl | null>(null);
/** 导航的内容画在抽屉里时是关上抽屉的函数，收起导航栏的开关那一格放关闭钮。 */
export const InDrawer = createContext<(() => void) | null>(null);

/** 在整页上认 ⌘/Ctrl + [，收起或展开宽屏的导航栏；lg 以下导航栏在抽屉里，不认。 */
export function useNavHotkey(toggle: () => void) {
	useEffect(() => {
		const apple = /mac|iphone|ipod|ipad|ios/i.test(navigator.userAgent);
		const onKeyDown = (event: KeyboardEvent) => {
			const mod = apple ? event.metaKey : event.ctrlKey;
			if (!mod || event.shiftKey || event.altKey) return;
			if (event.code !== "BracketLeft") return;
			if (!matchMedia(DOCKED_NAV).matches) return;
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
 * 收起或展开宽屏导航栏的开关：放在导航栏顶上（`AppNavHeader` 的 `toggle`），导航栏
 * 收起后由主栏页头的左端放一个。画在抽屉里时是关上抽屉的关闭钮。
 */
export function ToggleNavButton({ className }: { className?: string }) {
	const control = useNavControl();
	const closeDrawer = useContext(InDrawer);
	if (closeDrawer) return <AppNavDrawerClose onClose={closeDrawer} />;
	if (!control) return null;
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
