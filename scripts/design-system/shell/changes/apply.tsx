import { FileInput } from "lucide-react";
import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { APPLY_PATH } from "../../shared/protocol";
import { sources } from "../../shared/source-files";
import { type Placement, placements } from "../../shared/tokens/css";
import type { Draft } from "../../shared/tokens/draft";
import { tokenLabel } from "../../shared/tokens/registry";
import { ChangesPanel } from "./panel";
import { Unchanged } from "./token-changes";

/**
 * 「应用到源码」：列出每一项修改会写进哪个文件的哪个块，确认后交给开发服务器写回。
 * 写完清空修改；Vite 热更新后，设计系统读到的源文件值就是刚写进去的值。
 */
export function ApplyToSource({
	draft,
	onApplied,
	onNotice,
}: {
	draft: Draft;
	onApplied: () => void;
	onNotice: (message: string) => void;
}) {
	const [writing, setWriting] = useState(false);
	const files = [
		...placements(draft, sources)
			.reduce(
				(map, item) =>
					map.set(item.file, [...(map.get(item.file) ?? []), item]),
				new Map<string, Placement[]>(),
			)
			.entries(),
	];
	const write = async () => {
		setWriting(true);
		try {
			const response = await fetch(APPLY_PATH, {
				body: JSON.stringify(draft),
				headers: { "content-type": "application/json" },
				method: "POST",
			}).catch(() => null);
			if (!response) {
				onNotice("没能写入源码：开发服务器没有响应，修改仍然保留");
				return;
			}
			if (!response.ok) {
				onNotice(
					response.status === 400
						? "没能写入源码：开发服务器认为修改不合规，修改仍然保留"
						: "没能写入源码：开发服务器写文件时出错，详情见它的日志；修改仍然保留",
				);
				return;
			}
			const written = (await response.json()) as string[];
			onApplied();
			onNotice(`已写入 ${written.length} 个文件`);
		} finally {
			setWriting(false);
		}
	};
	return (
		<ChangesPanel
			actions={
				<Button
					disabled={files.length === 0}
					icon={FileInput}
					loading={writing}
					onClick={write}
					type="primary"
				>
					写入源码
				</Button>
			}
		>
			{files.length === 0 ? (
				<Unchanged description="在设计基础或组件页里调整令牌后，这里列出会写进哪些文件。" />
			) : (
				<div className="flex flex-col gap-5">
					<p className="text-fg-secondary text-xs">
						每一项写回声明它的那一行，文件里的其余内容不动。写完可以在版本管理里看到改了哪几行。
					</p>
					{files.map(([file, items]) => (
						<section className="flex flex-col gap-2" key={file}>
							<h3 className="font-mono text-xs">{file}</h3>
							<Block as="ul" gap={0} variant="outlined">
								{items.map(({ key, selector, value }) => (
									<li
										className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-border-secondary border-b px-3.5 py-2.5 text-xs last:border-b-0"
										key={`${selector} ${key}`}
									>
										<strong className="font-medium">{tokenLabel(key)}</strong>
										<code className="text-fg-tertiary">
											{selector} · {key}
										</code>
										<code className="ml-auto">{value}</code>
									</li>
								))}
							</Block>
						</section>
					))}
				</div>
			)}
		</ChangesPanel>
	);
}
