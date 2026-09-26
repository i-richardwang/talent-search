import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { cn } from "#/lib/utils";
import { catalog } from "../shared/catalog";
import { href, type Route } from "../shared/routes";

/** 窄屏时收进抽屉的那一份目录。 */
export const NAV_DRAWER_ID = "design-system-navigation-drawer";

/** 目录里的链接：当前那一项填一层底、字加粗；第一个 span 占满余下的宽。 */
const LINK =
	"flex min-w-0 items-center gap-2 rounded-md text-fg-secondary hover:bg-fill-tertiary focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 aria-[current=page]:bg-fill-secondary aria-[current=page]:font-semibold aria-[current=page]:text-fg [&>span:first-of-type]:min-w-0 [&>span:first-of-type]:flex-1 [&>span:first-of-type]:truncate [&>svg]:size-4 [&>svg]:shrink-0";

/**
 * 左栏的目录：总览，然后每个模块一组。模块名链到模块页，右边的页数和箭头展开收起；
 * 进到哪个模块，哪个模块就展开。
 */
export function Navigation({
	onNavigate,
	route,
}: {
	onNavigate?: () => void;
	route: Route;
}) {
	const current =
		route.kind === "module"
			? route.module
			: route.kind === "page"
				? route.page.module
				: undefined;
	const [expanded, setExpanded] = useState<Record<string, boolean>>({
		components: true,
	});
	useEffect(() => {
		if (current)
			setExpanded((previous) => ({ ...previous, [current.id]: true }));
	}, [current]);
	return (
		<nav aria-label="设计系统" className="flex flex-col gap-4 pt-4">
			<a
				aria-current={route.kind === "overview" ? "page" : undefined}
				className={cn(LINK, "px-2.5 py-2 text-sm")}
				href={href.overview}
				onClick={onNavigate}
			>
				<BookOpen />
				<span>总览</span>
			</a>
			{catalog.map((module) => {
				const Icon = module.icon;
				const open = expanded[module.id] ?? false;
				return (
					<section key={module.id}>
						<div className="flex items-center gap-1">
							<a
								aria-current={
									route.kind === "module" && module === current
										? "page"
										: undefined
								}
								className={cn(LINK, "flex-1 py-2 pr-1.5 pl-2.5 text-sm")}
								href={href.module(module)}
								onClick={onNavigate}
							>
								<Icon />
								<span>{module.title}</span>
							</a>
							<CollapsibleTrigger
								aria-label={`展开或收起${module.title}`}
								className="shrink-0 gap-1 rounded-md px-1 py-1.5 font-mono text-fg-tertiary text-xs hover:bg-fill-tertiary"
								onOpenChange={(next) =>
									setExpanded((previous) => ({
										...previous,
										[module.id]: next,
									}))
								}
								open={open}
								panelId={`nav-${module.id}`}
							>
								{module.pages.length}
							</CollapsibleTrigger>
						</div>
						<Collapsible id={`nav-${module.id}`} open={open}>
							<div className="mt-1 grid gap-0.5">
								{module.pages.map((page) => (
									<a
										aria-current={
											route.kind === "page" && route.page === page
												? "page"
												: undefined
										}
										className={cn(LINK, "py-1.5 pr-2.5 pl-9 text-xs")}
										href={href.page(page)}
										key={page.id}
										onClick={onNavigate}
									>
										<span>{page.title}</span>
									</a>
								))}
							</div>
						</Collapsible>
					</section>
				);
			})}
		</nav>
	);
}
