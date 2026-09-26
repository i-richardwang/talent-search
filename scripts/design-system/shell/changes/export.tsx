import { ArrowDownToLine, Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { requirePage } from "../../shared/catalog";
import { href } from "../../shared/routes";
import { sources } from "../../shared/source-files";
import { exportCss } from "../../shared/tokens/css";
import type { Draft } from "../../shared/tokens/draft";
import { ChangesPanel } from "./panel";

/** 下载的补丁的文件名。 */
const DOWNLOAD_NAME = "design-system-tokens.css";

/** 「应用到源码」那一页。 */
const APPLY_PAGE = requirePage("changes/apply");

/** 「CSS 导出」页：导出的内容放在一块卡片里。 */
export function ExportChanges(props: {
	draft: Draft;
	onNotice: (message: string) => void;
}) {
	return (
		<ChangesPanel>
			<ExportCode {...props} />
		</ChangesPanel>
	);
}

/** 导出的 CSS 与复制、下载；导出对话框和「CSS 导出」页共用。 */
export function ExportCode({
	draft,
	onNotice,
}: {
	draft: Draft;
	onNotice: (message: string) => void;
}) {
	const css = exportCss(draft, sources);
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 2000);
		return () => window.clearTimeout(timer);
	}, [copied]);
	return (
		<div className="flex flex-col gap-4">
			<p className="text-fg-secondary text-xs leading-5">
				每一段合并到注释写明的文件和代码块。导出不会写回源码；要直接写回，用
				<a href={href.page(APPLY_PAGE)}>「{APPLY_PAGE.title}」</a>。
			</p>
			<Block
				as="pre"
				className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs leading-6"
				padding={16}
				tabIndex={0}
				variant="filled"
			>
				<code>{css}</code>
			</Block>
			<div className="flex justify-end gap-2">
				<Button
					icon={copied ? Check : Copy}
					onClick={() =>
						navigator.clipboard.writeText(css).then(
							() => {
								setCopied(true);
								onNotice("CSS 已复制");
							},
							() => onNotice("无法访问剪贴板，请选中代码手动复制，或下载 CSS"),
						)
					}
				>
					复制 CSS
				</Button>
				<Button
					icon={ArrowDownToLine}
					onClick={() => {
						const url = URL.createObjectURL(
							new Blob([css], { type: "text/css;charset=utf-8" }),
						);
						const anchor = document.createElement("a");
						anchor.href = url;
						anchor.download = DOWNLOAD_NAME;
						anchor.click();
						window.setTimeout(() => URL.revokeObjectURL(url), 1000);
						onNotice("CSS 已下载");
					}}
					type="primary"
				>
					下载 CSS
				</Button>
			</div>
		</div>
	);
}
