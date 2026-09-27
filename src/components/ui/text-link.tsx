import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "#/lib/utils";

/*
 * 文字链接，样式在 text-link.css。通往一个对象的详情：表格里的词和姓名、详情里相邻的
 * 那个词。`render` 传路由的 `<Link>`，中键、右键照常。
 */

export function TextLink({
	className,
	render,
	...props
}: useRender.ComponentProps<"a">) {
	return useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(props, { className: cn("ui-text-link", className) }),
		render,
	});
}
