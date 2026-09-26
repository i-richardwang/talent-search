import type { ReactNode } from "react";

/** 右栏里的一节：标题，右边写修改作用在哪儿，再往右是这一节的动作。 */
export function Section({
	actions,
	children,
	scope,
	title,
}: {
	actions?: ReactNode;
	children: ReactNode;
	scope?: string;
	title: string;
}) {
	return (
		<section className="border-border-secondary border-b px-4 pt-3.5 pb-4 text-xs">
			<header className="mb-3 flex min-h-6 items-center gap-2">
				<h3 className="font-semibold">{title}</h3>
				{scope && <span className="ml-auto text-fg-tertiary">{scope}</span>}
				{actions}
			</header>
			{children}
		</section>
	);
}
