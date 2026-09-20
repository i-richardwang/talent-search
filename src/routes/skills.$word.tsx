import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import { SheetDescription } from "#/components/ui/sheet";
import { skillTerm } from "#/server/functions";
import type { SkillDetail } from "#/server/skills";
import { DetailSheet, Fact } from "./-components/detail-sheet";

/**
 * 一个能力词：它是什么意思，往上属于谁，往下带着谁。
 *
 * 表上那两列只说得下往上属于谁、往下有几项，具体是哪几项在这里：筛选栏上「数据分析」
 * 后面的人数是几支合起来的，这一层一眼看得见是哪几支、各有多少人。
 *
 * 父词和子词都是链接，点了就换成那个词：从属关系是一棵树，顺着往上往下走是读这棵树
 * 唯一的读法。走过的每一步都进历史，后退原路退回去——换一个词不是「换当前选中项」，
 * 是又看了一个词。
 *
 * 只读，同 `/skills`：整理是后台每天自动做的，改了下一轮灌库就被盖回去。
 */
export const Route = createFileRoute("/skills/$word")({
	loader: async ({ params }) => {
		const detail = await skillTerm({ data: { word: params.word } });
		if (!detail) throw notFound();
		return detail;
	},
	component: Term,
	notFoundComponent: () => (
		<TermSheet title="没有这个词">
			<Empty>
				<EmptyHeader>
					<EmptyTitle>词表里没有这个词</EmptyTitle>
					<EmptyDescription>
						它可能是上一轮整理并进了别的词，也可能还没被整理到。
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</TermSheet>
	),
});

/** 这一层的壳，真身和「没有这个词」共用。关掉就回到词表。 */
function TermSheet({
	title,
	description,
	children,
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	children: React.ReactNode;
}) {
	const navigate = useNavigate();
	// 关掉抽屉是回到刚才那张表，所以词和页码原样带回去
	const search = Route.useSearch();
	return (
		<DetailSheet
			close={() => void navigate({ search, to: "/skills" })}
			description={description}
			title={title}
		>
			{children}
		</DetailSheet>
	);
}

function Term() {
	const term: SkillDetail = Route.useLoaderData();
	return (
		<TermSheet
			description={
				/* 释义是判定方给这个词写的那一句，说的正是这个词指什么，所以它就是抬头下面那一句 */
				term.gloss ? (
					<SheetDescription>{term.gloss}</SheetDescription>
				) : undefined
			}
			title={term.canonical}
		>
			<dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-sm">
				<Fact label="人数">
					<span className="tabular-nums">{term.people}</span>
					<span className="text-muted-foreground"> 人（含细分）</span>
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
					<p className="label text-muted-foreground">细分</p>
					<ul className="flex flex-col gap-1 text-sm">
						{term.children.map((child) => (
							<li key={child.canonical}>
								<TermLink people={child.people} word={child.canonical} />
							</li>
						))}
					</ul>
				</div>
			)}
		</TermSheet>
	);
}

/** 相邻的一个词（更宽的那个，或者它的一项细分），连它那一支的人数。 */
function TermLink({ word, people }: { word: string; people: number }) {
	// 换一个词看，底下那张表停在原处：从哪一页点开的就还是哪一页
	const search = Route.useSearch();
	return (
		<Link
			className="underline-offset-4 hover:underline"
			params={{ word }}
			search={search}
			to="/skills/$word"
		>
			{word}
			<span className="ms-2 text-muted-foreground tabular-nums">{people}</span>
		</Link>
	);
}
