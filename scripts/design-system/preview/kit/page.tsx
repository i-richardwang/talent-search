import { ArrowDownToLine } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Tag } from "#/components/ui/tag";
import { useCurrentPage } from "../state";
import { type PageRules, RULES_HEADINGS, rulesMarkdown } from "./rules";

/*
 * 预览页里一页说明的骨架：页头、页内目录、分节与页底的使用规则。标题、导出名和源文件
 * 读目录里这一页的那一项；它们只管排版，里面放的都是生产组件，不覆盖组件自己的样式。
 */

interface PageSection {
	id: string;
	title: string;
	/** 分节标题右边的小标签，写这一节正在看的档位之类。 */
	tag?: string;
	children: ReactNode;
}

/**
 * 一个组件或一页设计基础：标题（组件页后面跟导出名）、几个说明它有多少种形态的标签、
 * 页内目录，然后逐节往下排，最后是使用规则。
 */
export function DocPage({
	facts,
	rules,
	sections,
}: {
	facts?: string[];
	rules?: PageRules;
	sections: PageSection[];
}) {
	const { name, title } = useCurrentPage();
	return (
		<div className="mx-auto max-w-6xl p-8 max-md:p-6">
			<header>
				<h1 className="font-semibold text-2xl tracking-tight">
					{title}
					{name && (
						<span className="ml-2 font-normal font-mono text-fg-tertiary text-lg tracking-normal">
							{name}
						</span>
					)}
				</h1>
				{facts && facts.length > 0 && (
					<div className="mt-4 flex flex-wrap gap-2">
						{facts.map((fact) => (
							<Tag key={fact} size="small" variant="outlined">
								{fact}
							</Tag>
						))}
					</div>
				)}
			</header>
			{sections.length > 1 && (
				<nav
					aria-label={`${title}页面目录`}
					className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-border-secondary border-b py-4 text-xs"
				>
					{sections.map((section) => (
						<a
							className="text-fg-secondary underline-offset-4 hover:text-fg hover:underline"
							href={`#${section.id}`}
							key={section.id}
						>
							{section.title}
						</a>
					))}
				</nav>
			)}
			{sections.map((section) => (
				<section
					aria-labelledby={`${section.id}-title`}
					className="mt-8 scroll-mt-5"
					id={section.id}
					key={section.id}
				>
					<div className="mb-4 flex items-start justify-between gap-3">
						<h2 className="font-semibold text-lg" id={`${section.id}-title`}>
							{section.title}
						</h2>
						{section.tag && (
							<Tag className="font-mono" size="small" variant="outlined">
								{section.tag}
							</Tag>
						)}
					</div>
					{section.children}
				</section>
			))}
			{rules && <Rules rules={rules} />}
		</div>
	);
}

/**
 * 页底收起的「使用规则与代码」。展开后是源文件与下载按钮，下面按 Markdown 的两节排：
 * 写法、要点；下载的就是 `rulesMarkdown` 写出的这一份。
 */
function Rules({ rules }: { rules: PageRules }) {
	const { name, slug, source = [], title } = useCurrentPage();
	const [open, setOpen] = useState(false);
	const markdown = rulesMarkdown({ name, rules, source, title });
	return (
		<div className="mt-7 border-border-secondary border-t pt-4">
			<CollapsibleTrigger
				className="font-semibold text-base"
				onOpenChange={setOpen}
				open={open}
				panelId="page-rules"
			>
				使用规则与代码
			</CollapsibleTrigger>
			<Collapsible id="page-rules" open={open}>
				<div className="flex flex-col gap-4 pt-5 text-fg-secondary text-sm leading-6">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<code className="text-fg-tertiary text-xs">
							{source.join(" · ")}
						</code>
						<Button
							icon={ArrowDownToLine}
							render={
								<a
									download={`${slug}.md`}
									href={`data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`}
								/>
							}
							size="small"
						>
							下载 Markdown
						</Button>
					</div>
					<h3 className="font-semibold text-fg text-sm">
						{RULES_HEADINGS.usage}
					</h3>
					<Block padding={16} variant="filled">
						<pre className="overflow-x-auto font-mono text-fg text-xs leading-5">
							{rules.usage}
						</pre>
					</Block>
					<h3 className="font-semibold text-fg text-sm">
						{RULES_HEADINGS.notes}
					</h3>
					<ul className="flex list-disc flex-col gap-1.5 pl-5">
						{rules.notes.map((note) => (
							<li key={note}>{note}</li>
						))}
					</ul>
				</div>
			</Collapsible>
		</div>
	);
}
