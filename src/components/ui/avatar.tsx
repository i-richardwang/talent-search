import type { CSSProperties } from "react";
import { cn } from "#/lib/utils";

/*
 * 文字头像，样式在 avatar.css。人才库里没有照片，头像就是名字的缩写：见方的一块，
 * 底默认是 border 那一档灰，字取底色的反差色（亮底黑字、暗底白字）。字号是边长的一半；
 * 两个汉字时是边长的 0.36，一个汉字占满一个字宽，两个按一半排会顶满整块。
 *
 * 缩写：含汉字的名字取末两个字（「张三丰」写「三丰」，姓加名的头一个字会拆开名字），
 * 其余取头两个字符并大写。`sliceText={false}` 时整段原样显示。
 *
 * 圆角：`shape="circle"` 是正圆；方形边长不到 24 时是 33%，否则是边长的六分之一、至少 2px。
 * 头像旁边总写着全名，所以对读屏隐藏，不重复念一遍缩写。
 */

interface AvatarProps {
	/** 名字，缩写从它来。 */
	title: string;
	/** 底色，缺省 `--color-border`；字色随它自动取反差色。 */
	background?: string;
	className?: string;
	/** @default "square" */
	shape?: "circle" | "square";
	/** 边长，px。@default 48 */
	size?: number;
	/** 只显示缩写。@default true */
	sliceText?: boolean;
	style?: CSSProperties;
}

const CJK = /\p{Script=Han}/u;

/** 名字的缩写：含汉字取末两个字，其余取头两个字符并大写。 */
function avatarText(title: string, sliceText = true): string {
	const text = title.trim();
	if (!sliceText) return text.toUpperCase();
	const chars = Array.from(text);
	if (CJK.test(text)) return chars.slice(-2).join("");
	return chars.slice(0, 2).join("").toUpperCase();
}

function radiusOf(shape: "circle" | "square", size: number): string {
	if (shape === "circle") return "50%";
	return size < 24 ? "33%" : `${Math.max(size / 6, 2)}px`;
}

export function Avatar({
	title,
	background,
	className,
	shape = "square",
	size = 48,
	sliceText = true,
	style,
}: AvatarProps) {
	const text = avatarText(title, sliceText);
	const wide = CJK.test(text) && Array.from(text).length > 1;
	return (
		<span
			aria-hidden
			className={cn("ui-avatar", className)}
			style={
				{
					"--ui-avatar-bg": background,
					borderRadius: radiusOf(shape, size),
					fontSize: size * (wide ? 0.36 : 0.5),
					height: size,
					width: size,
					...style,
				} as CSSProperties
			}
		>
			<span className="ui-avatar-content">{text}</span>
		</span>
	);
}
