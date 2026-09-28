import { ArrowRight, CircleDashed } from "lucide-react";
import { Block, BlockLink } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Empty } from "#/components/ui/empty";
import { type CatalogModule, catalog } from "../../shared/catalog";
import { href } from "../../shared/routes";

/** 总览：每个模块一张卡片。 */
export function Overview() {
	return (
		<div className="grid max-w-7xl grid-cols-3 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
			{catalog.map((module, index) => {
				const Icon = module.icon;
				return (
					<Block
						className="min-w-0"
						clickable
						gap={12}
						key={module.id}
						padding={24}
						variant="outlined"
					>
						<div className="mb-4 flex items-center justify-between text-fg-tertiary">
							<Icon className="size-6 text-fg" strokeWidth={1.5} />
							<span className="font-mono text-xs">
								{String(index + 1).padStart(2, "0")}
							</span>
						</div>
						<h2 className="font-semibold text-lg">
							<BlockLink href={href.module(module)}>{module.title}</BlockLink>
						</h2>
						<p className="flex-1 text-base text-fg-secondary">
							{module.description}
						</p>
						<div className="mt-6 flex items-center justify-between text-fg-tertiary text-xs">
							<span>{`${module.pages.length} 页`}</span>
							<ArrowRight className="size-4" />
						</div>
					</Block>
				);
			})}
		</div>
	);
}

/** 模块页：一句说明，下面每页一张卡片。 */
export function ModuleIndex({ module }: { module: CatalogModule }) {
	return (
		<>
			<div className="mb-6 flex flex-wrap items-baseline justify-between gap-3 text-base text-fg-secondary">
				<p>{module.description}</p>
				<span className="text-xs">{`${module.pages.length} 页`}</span>
			</div>
			<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
				{module.pages.map((page) => (
					<Block
						align="center"
						clickable
						gap={16}
						horizontal
						key={page.id}
						padding={20}
						variant="outlined"
					>
						<h2 className="flex flex-1 items-baseline gap-2 font-medium text-base">
							<BlockLink href={href.page(page)}>{page.title}</BlockLink>
							{page.name && (
								<span className="font-mono font-normal text-fg-tertiary text-xs">
									{page.name}
								</span>
							)}
						</h2>
						<ArrowRight className="size-4 shrink-0" />
					</Block>
				))}
			</div>
		</>
	);
}

/** 地址里的页不在目录里。 */
export function NotFound() {
	return (
		<Block
			align="center"
			className="min-h-80 border-dashed"
			justify="center"
			padding={28}
			variant="outlined"
		>
			<Empty
				action={<Button render={<a href={href.overview} />}>回到总览</Button>}
				description="地址里的页面不在目录里。"
				icon={CircleDashed}
				title="页面不存在"
			/>
		</Block>
	);
}
