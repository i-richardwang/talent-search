import { Link } from "@tanstack/react-router";
import { DrawerDescription } from "#/components/ui/drawer";
import { TextLink } from "#/components/ui/text-link";
import type { SkillDetail } from "#/server/skills";
import { DetailDrawer, Fact } from "../../-components/detail-drawer";

/*
 * 技能页点开一个词（`routes/skills/$word.tsx`）：抽屉的壳，和壳里这个词的释义与上下从属。
 */

/** 这一层的壳，真身和「没有这个词」共用。关掉往哪回由调用方给（`close`）。 */
export function TermDrawer({
	close,
	title,
	description,
	children,
}: {
	/** 滑回右边之后往哪走：回到刚才那张表 */
	close: () => void;
	title: React.ReactNode;
	description?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<DetailDrawer close={close} description={description} title={title}>
			{children}
		</DetailDrawer>
	);
}

/** 一个词的释义、人数、往上属于谁、往下带着谁。`close` 由路由给：关掉回到词表。 */
export function TermRecord({
	term,
	close,
}: {
	term: SkillDetail;
	close: () => void;
}) {
	return (
		<TermDrawer
			close={close}
			description={
				/* 释义是判定方给这个词写的那一句，说的正是这个词指什么，所以它就是抬头下面那一句 */
				term.gloss ? (
					<DrawerDescription className="text-fg-secondary text-sm">
						{term.gloss}
					</DrawerDescription>
				) : undefined
			}
			title={term.canonical}
		>
			<dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-base">
				<Fact label="人数">
					<span className="tabular-nums">{term.people}</span>
					<span className="text-fg-secondary"> 人（含细分）</span>
				</Fact>
				{term.parent && (
					<Fact label="属于">
						<TermLink
							people={term.parent.people}
							word={term.parent.canonical}
						/>
					</Fact>
				)}
				{term.aliases.length > 0 && (
					<Fact label="其他写法">{term.aliases.join("、")}</Fact>
				)}
				<Fact label="上次整理">
					{term.reviewedDaysAgo === 0 ? "今天" : `${term.reviewedDaysAgo} 天前`}
				</Fact>
			</dl>
			{term.children.length > 0 && (
				<div className="flex flex-col gap-1">
					<p className="text-xs font-medium text-fg-secondary">细分</p>
					<ul className="flex flex-col gap-1 text-base">
						{term.children.map((child) => (
							<li key={child.canonical}>
								<TermLink people={child.people} word={child.canonical} />
							</li>
						))}
					</ul>
				</div>
			)}
		</TermDrawer>
	);
}

/** 相邻的一个词（更宽的那个，或者它的一项细分），连它那一支的人数。 */
function TermLink({ word, people }: { word: string; people: number }) {
	return (
		// 换一个词看，底下那张表停在原处：从哪一页点开的就还是哪一页
		<TextLink
			render={
				<Link
					from="/skills/$word"
					params={{ word }}
					search={(prev) => prev}
					to="/skills/$word"
				/>
			}
		>
			{word}
			<span className="ms-2 text-fg-secondary tabular-nums">{people}</span>
		</TextLink>
	);
}
