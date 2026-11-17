import BoringAvatar from "boring-avatars";
import type { CSSProperties } from "react";
import { cn } from "#/lib/utils";

/**
 * 头像的固定配色：炭黑、紫、米白、黄、橙，和 lobe-ui 生成头像用的同一组。图是 SVG，颜色写在
 * 属性里，读不到令牌；也正因为固定，同一个人在深浅两侧是同一张头像。
 */
const COLORS = ["#383838", "#7858f9", "#f8f7bf", "#ffdd1f", "#f88c13"];

/**
 * 头像：方形的像素图，由 `seed` 生成，同一个种子永远是同一张。种子用账号的用户名：唯一，
 * 改显示名称也不换头像。边长由 `size` 给，圆角是边长的六分之一。头像总跟在名字旁边，
 * 对读屏是装饰。
 */
export function Avatar({
	seed,
	size,
	className,
}: {
	seed: string;
	/** 边长，像素 */
	size: number;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn("ui-avatar", className)}
			style={{ "--avatar-size": `${size}px` } as CSSProperties}
		>
			<BoringAvatar
				colors={COLORS}
				name={seed}
				size="100%"
				square
				variant="pixel"
			/>
		</span>
	);
}
