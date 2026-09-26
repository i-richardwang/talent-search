import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { href } from "../../shared/routes";
import { type Draft, draftEntries } from "../../shared/tokens/draft";
import { tokenLabel } from "../../shared/tokens/registry";
import { pagesOfFile, usagesOf } from "../impact";
import { useSourceFiles } from "../source-files";
import { ChangesPanel } from "./panel";
import { Unchanged } from "./token-changes";

/**
 * 影响范围：每一项修改在代码里被哪些文件读到。目录里有页演示的文件给出那一页的链接，
 * 其余按文件列出。
 */
export function ImpactScope({ draft }: { draft: Draft }) {
	const files = useSourceFiles();
	const keys = [...new Set(draftEntries(draft).map(({ key }) => key))];
	return (
		<ChangesPanel>
			{keys.length === 0 ? (
				<Unchanged description="调整令牌后，这里列出每一项修改会波及的组件和页面文件。" />
			) : !files ? (
				<Skeleton.Text rows={4} />
			) : (
				<div className="flex flex-col divide-y divide-border-secondary">
					{keys.map((key) => {
						const usages = usagesOf(key, files);
						const pages = [
							...new Map(
								usages
									.flatMap(({ file }) => pagesOfFile(file))
									.map((page) => [page.id, page]),
							).values(),
						];
						const others = usages.filter(
							({ file }) => pagesOfFile(file).length === 0,
						);
						return (
							<section
								className="flex flex-col gap-2.5 py-4 first:pt-0 last:pb-0"
								key={key}
							>
								<div className="flex flex-wrap items-baseline gap-x-2.5">
									<strong className="font-semibold text-sm">
										{tokenLabel(key)}
									</strong>
									<code className="text-fg-tertiary text-xs">{key}</code>
									<span className="ml-auto text-fg-tertiary text-xs tabular-nums">
										{usages.length} 个文件
									</span>
								</div>
								{pages.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{pages.map((page) => (
											<Button
												key={page.id}
												render={<a href={href.page(page)} />}
												size="small"
												type="fill"
											>
												{page.title}
											</Button>
										))}
									</div>
								)}
								{others.length > 0 && (
									<ul className="flex flex-col gap-0.5 text-fg-secondary text-xs">
										{others.map(({ count, file }) => (
											<li className="flex gap-3" key={file}>
												<code className="min-w-0 truncate">{file}</code>
												<span className="ml-auto shrink-0 text-fg-tertiary tabular-nums">
													{count} 处
												</span>
											</li>
										))}
									</ul>
								)}
							</section>
						);
					})}
				</div>
			)}
		</ChangesPanel>
	);
}
