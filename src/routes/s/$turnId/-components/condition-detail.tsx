import { CheckIcon, ListFilterIcon, XIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Accordion } from "#/components/ui/accordion";
import { Block } from "#/components/ui/block";
import { Descriptions, DescriptionsItem } from "#/components/ui/descriptions";
import { Divider } from "#/components/ui/divider";
import { Icon } from "#/components/ui/icon";
import { Tag } from "#/components/ui/tag";
import { Text } from "#/components/ui/text";
import { duration } from "#/lib/format";
import { labelsInSentence, type QueryCondition } from "#/search/query";
import type { ConditionExplained, Option, Piece, Row } from "#/server/explain";
import { IconCell } from "./icon-cell";

/**
 * 一轮整理出的几条搜索条件，每条一行，和检索过程的步骤同一种行：图标格、名称，点开是详情，
 * 末尾一条虚线。详情见 `ConditionDetail`。
 */
export function ConditionList({
	conditions,
	explained,
}: {
	conditions: readonly QueryCondition[];
	explained: Readonly<Record<string, ConditionExplained>>;
}) {
	return (
		<Accordion
			items={conditions.map((c) => {
				const e = explained[c.id];
				return {
					children: e && hasContent(e) && (
						<div className="flex flex-col gap-2 py-2">
							<ConditionDetail condition={c} explained={e} />
							<Divider className="mt-2 mb-0" dashed />
						</div>
					),
					key: c.id,
					title: (
						<span className="flex min-w-0 items-center gap-1.5">
							<IconCell className="text-fg-secondary" icon={ListFilterIcon} />
							<span className="min-w-0">{labelsInSentence([c])}</span>
						</span>
					),
				};
			})}
		/>
	);
}

function hasContent(e: ConditionExplained) {
	return e.work !== null || e.options.length > 0 || e.months !== null;
}

/**
 * 一条条件要的那段经历（或那个人），一块填充的面，里面分几节，都要满足：工作内容（判断
 * 标准）、经历范围（一种一张描边的卡，卡头是经历的来源，卡里一行一个属性，卡与卡之间是
 * 「或」）、累计时长。内容是服务端照真正执行的条件解析出来的（`server/explain.ts`），名称
 * 和它对不上时 HR 在这里看得出来。属性名和名单上方的筛选同一套。
 */
export function ConditionDetail({
	condition,
	explained: { work, options, months },
}: {
	condition: QueryCondition;
	explained: ConditionExplained;
}) {
	const person = condition.from === "person";
	return (
		<Block gap={12} padding={12}>
			{condition.mode === "exclude" && (
				<Text type="secondary">有下面这样一段经历的人不要</Text>
			)}
			{work && (
				<Section title="工作内容">
					{"criterion" in work ? (
						<Criterion text={work.criterion} />
					) : (
						<span className="flex flex-wrap items-center gap-1">
							<Text>简历里写到</Text>
							<Pieces pieces={work.written} />
						</span>
					)}
				</Section>
			)}
			{options.length > 0 && (
				<Section
					hint={options.length > 1 ? "符合其中一种" : undefined}
					title={person ? "人员要求" : "经历范围"}
				>
					<Options options={options} />
				</Section>
			)}
			{months !== null && (
				<Section title="累计时长">
					<Text>以上经历加起来至少 {duration(months)}</Text>
				</Section>
			)}
		</Block>
	);
}

/** 一节：小字的节名在上，`hint` 跟在节名后面说怎么读这一节。 */
function Section({
	title,
	hint,
	children,
}: {
	title: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1.5">
			<Text size="xs" type="tertiary">
				{title}
				{hint && ` · ${hint}`}
			</Text>
			{children}
		</section>
	);
}

/**
 * 判断标准一句一行：说到「不算」的句子前面一个叉，以「算」结尾的一个勾，别的照写。只是排版，
 * 不改一个字。
 */
function Criterion({ text }: { text: string }) {
	const sentences = text
		.split(/(?<=[。；;])/)
		.map((s) => s.trim())
		.filter(Boolean);
	return (
		<ul className="flex flex-col gap-1">
			{sentences.map((s, i) => {
				const mark = /不算/.test(s)
					? XIcon
					: /算[。；;]?$/.test(s)
						? CheckIcon
						: null;
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: 句子只随条件整份换，位置就是一句的身份
					<li className="flex gap-1.5" key={i}>
						{mark && (
							<Icon
								aria-hidden="true"
								className="mt-1 shrink-0 text-fg-tertiary"
								icon={mark}
								size={12}
							/>
						)}
						<span>{s}</span>
					</li>
				);
			})}
		</ul>
	);
}

/** 几种之一：一种一张卡，卡与卡之间一条带「或」的分隔线。 */
function Options({ options }: { options: readonly Option[] }) {
	return (
		<div className="flex flex-col">
			{options.map((option, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: 说明只随条件整份换，位置就是一种的身份
				<Fragment key={i}>
					{i > 0 && (
						<Divider className="my-0 py-1">
							<Text size="xs" type="tertiary">
								或
							</Text>
						</Divider>
					)}
					<Card option={option} />
				</Fragment>
			))}
		</div>
	);
}

/** 一种经历一张卡：卡头是来源，卡里一行一个属性，都要满足。 */
function Card({ option: { lead, rows } }: { option: Option }) {
	const flat = rows.filter((r) => r.kind !== "nested");
	const nested = rows.filter(
		(r): r is Extract<Row, { kind: "nested" }> => r.kind === "nested",
	);
	return (
		<Block gap={8} padding={10} variant="outlined">
			{lead && <Text weight="medium">{lead}</Text>}
			{flat.length > 0 && (
				<Descriptions size="small">
					{flat.map((row, i) =>
						row.kind === "fact" ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: 同上
							<DescriptionsItem key={i} label={row.field}>
								<Pieces pieces={row.value} />
							</DescriptionsItem>
						) : (
							// biome-ignore lint/suspicious/noArrayIndexKey: 同上
							<DescriptionsItem key={i} label="其他">
								<Text type="tertiary">另有一项限定，这里说不清楚</Text>
							</DescriptionsItem>
						),
					)}
				</Descriptions>
			)}
			{nested.map((row, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: 同上
				<Section key={i} title={row.head}>
					<Options options={row.options} />
				</Section>
			))}
		</Block>
	);
}

/** 一项的取值：人才库里的取值画成标签，连接的字照写，取值之间的「/」淡一档。 */
function Pieces({ pieces }: { pieces: readonly Piece[] }) {
	return (
		<span className="inline-flex flex-wrap items-center gap-1">
			{pieces.map((p, i) =>
				"tag" in p ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: 同上
					<Tag key={i} size="small">
						{p.tag}
					</Tag>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: 同上
					<Text key={i} type={p.word === "/" ? "quaternary" : undefined}>
						{p.word}
					</Text>
				),
			)}
		</span>
	);
}
