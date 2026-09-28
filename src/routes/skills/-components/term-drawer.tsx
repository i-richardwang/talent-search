import { Link } from "@tanstack/react-router";
import { Descriptions, DescriptionsItem } from "#/components/ui/descriptions";
import { DrawerDescription } from "#/components/ui/drawer";
import { List, ListItem } from "#/components/ui/list";
import { TextLink } from "#/components/ui/text-link";
import { integer } from "#/lib/format";
import type { SkillDetail } from "#/server/skills";
import {
	DETAIL_LABEL_WIDTH,
	DetailDrawer,
	DetailSection,
} from "../../-components/detail-drawer";
import { daysAgo } from "./skill-table";

/** 一个词的释义、人数、往上属于谁、往下带着谁。 */
export function TermRecord({
	term,
	close,
}: {
	term: SkillDetail;
	close: () => void;
}) {
	return (
		<DetailDrawer
			close={close}
			description={
				term.gloss ? (
					<DrawerDescription className="text-fg-secondary text-sm">
						{term.gloss}
					</DrawerDescription>
				) : undefined
			}
			title={term.canonical}
		>
			<Descriptions labelWidth={DETAIL_LABEL_WIDTH}>
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
					{daysAgo(term.reviewedDaysAgo)}
				</DescriptionsItem>
			</Descriptions>
			{term.children.length > 0 && (
				<DetailSection count={`${term.children.length} 项`} title="细分">
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
				</DetailSection>
			)}
		</DetailDrawer>
	);
}

/** 去另一个词的链接，地址参数原样带着：底下那张表还停在点开时那一页。 */
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
