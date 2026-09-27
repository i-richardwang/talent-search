import { Link } from "@tanstack/react-router";
import { Descriptions, DescriptionsItem } from "#/components/ui/descriptions";
import { DrawerDescription } from "#/components/ui/drawer";
import { List, ListItem } from "#/components/ui/list";
import { Text } from "#/components/ui/text";
import { TextLink } from "#/components/ui/text-link";
import { integer } from "#/lib/format";
import type { SkillDetail } from "#/server/skills";
import { DetailDrawer } from "../../-components/detail-drawer";

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
			<Descriptions labelWidth={96}>
				<DescriptionsItem label="人数">
					<span className="tabular-nums">{integer(term.people)}</span>
					<span className="text-fg-secondary"> 人（含细分）</span>
				</DescriptionsItem>
				{term.parent && (
					<DescriptionsItem label="属于">
						<TermLink
							people={term.parent.people}
							word={term.parent.canonical}
						/>
					</DescriptionsItem>
				)}
				{term.aliases.length > 0 && (
					<DescriptionsItem label="其他写法">
						{term.aliases.join("、")}
					</DescriptionsItem>
				)}
				<DescriptionsItem label="上次整理">
					{term.reviewedDaysAgo === 0 ? "今天" : `${term.reviewedDaysAgo} 天前`}
				</DescriptionsItem>
			</Descriptions>
			{term.children.length > 0 && (
				<section className="flex flex-col gap-2">
					<h3 className="flex items-baseline gap-1.5">
						<Text size="sm" type="secondary" weight="medium">
							细分
						</Text>
						<Text size="xs" type="quaternary">
							{term.children.length} 项
						</Text>
					</h3>
					{/* 换一个词看，底下那张表停在原处：从哪一页点开的就还是哪一页 */}
					<List>
						{term.children.map((child) => (
							<ListItem
								extra={
									<span className="tabular-nums">
										{integer(child.people)} 人
									</span>
								}
								key={child.canonical}
								render={termRoute(child.canonical)}
								title={child.canonical}
							/>
						))}
					</List>
				</section>
			)}
		</TermDrawer>
	);
}

/** 换成另一个词的那条路由链接；底下那张表停在原处，从哪一页点开的就还是哪一页。 */
function termRoute(word: string) {
	return (
		<Link
			from="/skills/$word"
			params={{ word }}
			search={(prev) => prev}
			to="/skills/$word"
		/>
	);
}

/** 往上属于的那个词，连它那一支的人数。 */
function TermLink({ word, people }: { word: string; people: number }) {
	return (
		<TextLink render={termRoute(word)}>
			{word}
			<span className="ms-2 text-fg-secondary tabular-nums">
				{integer(people)}
			</span>
		</TextLink>
	);
}
