import { Link } from "@tanstack/react-router";
import { ListRestartIcon } from "lucide-react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Descriptions, DescriptionsItem } from "#/components/ui/descriptions";
import {
	type DropdownItem,
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { List, ListItem } from "#/components/ui/list";
import { TextLink } from "#/components/ui/text-link";
import { integer } from "#/lib/format";
import type { Rejudge } from "#/lib/task";
import type { TermDetail } from "#/server/terms";
import {
	DETAIL_LABEL_WIDTH,
	DetailDrawer,
	DetailSection,
} from "../../-components/detail-drawer";
import { daysAgo } from "./term-table";

/**
 * 一个词的人数、往上属于谁、往下带着谁；判成不是能力的词只有人数和这一句结论。
 * `rejudge` 只有管理员有：把这一项（连同它的其他写法），或再带上它的细分，退回重新判定。
 */
export function TermRecord({
	term,
	close,
	rejudge,
}: {
	term: TermDetail;
	close: () => void;
	rejudge?: (scope: Rejudge) => void;
}) {
	return (
		<DetailDrawer
			close={close}
			extra={rejudge && <RejudgeMenu rejudge={rejudge} term={term} />}
			title={term.canonical}
		>
			<Descriptions labelWidth={DETAIL_LABEL_WIDTH}>
				<DescriptionsItem label="人数">
					<span className="tabular-nums">{integer(term.people)}</span>
					<span className="text-fg-secondary">
						{term.excluded ? " 人" : " 人（含细分）"}
					</span>
				</DescriptionsItem>
				{term.excluded && (
					<DescriptionsItem label="判定">
						不是能力，不出现在筛选和候选词里
					</DescriptionsItem>
				)}
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
				<DescriptionsItem label="上次判定">
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

/** 把这一项退回重新判定；它下面有细分时可以连细分一起。 */
function RejudgeMenu({
	term,
	rejudge,
}: {
	term: TermDetail;
	rejudge: (scope: Rejudge) => void;
}) {
	const item = (key: string, label: string, branch: boolean): DropdownItem => ({
		key,
		label,
		onClick: () => rejudge({ branch, scope: "term", word: term.canonical }),
	});
	const items = [item("term", "重新判定这一项", false)];
	if (term.children.length > 0)
		items.push(item("branch", "连同细分一起重新判定", true));
	return (
		<DropdownMenuRoot>
			<DropdownMenuTrigger>
				<ActionIcon aria-label="重新判定" icon={ListRestartIcon} />
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuPositioner>
					<DropdownMenuPopup>
						{renderDropdownMenuItems(items)}
					</DropdownMenuPopup>
				</DropdownMenuPositioner>
			</DropdownMenuPortal>
		</DropdownMenuRoot>
	);
}

/** 去另一个词的链接，地址参数原样带着：底下那张表还停在点开时那一页。 */
function termRoute(word: string) {
	return (
		<Link
			from="/terms/$word"
			params={{ word }}
			search={(prev) => prev}
			to="/terms/$word"
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
