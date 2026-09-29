import { cn } from "#/lib/utils";

/*
 * 文字头像：人才库里没有照片，头像是名字的缩写。含汉字的名字取末两个字（「张三丰」写
 * 「三丰」，姓加名的头一个字会拆开名字），其余取头两个字符并大写。头像旁边总写着全名，
 * 所以对读屏隐藏，不重复读一遍缩写。
 */

interface AvatarProps {
	title: string;
	className?: string;
}

const CJK = /\p{Script=Han}/u;

function avatarText(title: string): string {
	const text = title.trim();
	const chars = Array.from(text);
	if (CJK.test(text)) return chars.slice(-2).join("");
	return chars.slice(0, 2).join("").toUpperCase();
}

export function Avatar({ title, className }: AvatarProps) {
	const text = avatarText(title);
	const wide = CJK.test(text) && Array.from(text).length > 1;
	return (
		<span
			aria-hidden
			className={cn("ui-avatar", wide && "ui-avatar-wide", className)}
		>
			<span className="ui-avatar-content">{text}</span>
		</span>
	);
}
