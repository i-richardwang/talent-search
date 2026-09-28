import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "#/lib/utils";

/* 通往一个对象的详情：表格里的词和姓名、详情里相邻的那个词。`render` 传路由的 `<Link>`。 */

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
