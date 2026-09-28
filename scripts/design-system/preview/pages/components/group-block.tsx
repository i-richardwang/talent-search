import {
	GitMergeIcon,
	ListChecksIcon,
	MessageSquareTextIcon,
	TextSearchIcon,
} from "lucide-react";
import { useState } from "react";
import { Checkbox } from "#/components/ui/checkbox";
import {
	GroupBlock,
	GroupBlockAction,
	GroupBlockItem,
} from "#/components/ui/group-block";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { stay } from "../../kit/stay";

const RECORDS = [
	{
		description: "推荐系统、团队管理（加分）",
		extra: "3 分钟前",
		icon: MessageSquareTextIcon,
		title: "找做过推荐系统的算法工程师",
	},
	{
		description: undefined,
		extra: "昨天",
		icon: TextSearchIcon,
		title: "推荐系统 · 某甲科技",
	},
	{
		description: "支付风控、学校 · 学校 B",
		extra: "8月13日",
		icon: MessageSquareTextIcon,
		title: "找做过支付风控、学校 B 毕业的",
	},
];

function Playground() {
	const [count, setCount] = useState(true);
	const [action, setAction] = useState(true);
	const [description, setDescription] = useState(true);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={count} onChange={setCount}>
						组名后的数
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={action} onChange={setAction}>
						组名行尾的动作
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={description} onChange={setDescription}>
						第二行说明
					</Checkbox>
				</Control>
			</Controls>
			<Stage footer={<span>一条整行可点，悬停出底</span>}>
				<div className="w-full max-w-page px-6">
					<GroupBlock
						action={action && <GroupBlockAction>查看全部</GroupBlockAction>}
						count={count ? RECORDS.length : undefined}
						title="最近搜索"
					>
						{RECORDS.map((record) => (
							<GroupBlockItem
								description={description ? record.description : undefined}
								extra={record.extra}
								href="#record"
								icon={record.icon}
								key={record.title}
								onClick={stay}
								title={record.title}
							/>
						))}
					</GroupBlock>
				</div>
			</Stage>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="一句可以拿去用的话：标题可以折行，组名下面一行小字说怎么用。"
				title="起步的例子"
			>
				<div className="w-full px-3">
					<GroupBlock
						className="px-3 py-2"
						description="点一条填进输入框，改成你要找的人再发送"
						title="可以这样描述"
					>
						<GroupBlockItem
							description="一句话里写几样要求，找的是样样都满足的人"
							icon={ListChecksIcon}
							render={<button type="button" />}
							title="做过线下渠道运营、带过团队的人"
							variant="prose"
						/>
						<GroupBlockItem
							description="「都做过」：两段经历都要有"
							icon={GitMergeIcon}
							render={<button type="button" />}
							title="算法和后端都做过的"
							variant="prose"
						/>
					</GroupBlock>
				</div>
			</Example>
		</ExampleGrid>
	);
}

export function GroupBlockPage() {
	return (
		<DocPage
			facts={["组名与数", "两行条目", "时间一列"]}
			rules={{
				notes: [
					"首页输入框下面的一组条目用它：做过的事（最近搜索）用缺省的 record，一句可以拿去用的话（起步的例子）用 prose。",
					'一条整行可点：render 传路由的 <Link>，只填进输入框的一条传 render={<button type="button" />}。',
					"组名后的 count 数的是这一组列出来的条数；列不完时组名行尾放 GroupBlockAction「查看全部」。",
					"行尾的 extra 放时间，几行的时间竖着对成一列。",
					"条目的字和组名、上面的输入框对齐，悬停的底比它们宽一截。",
				],
				usage: `<GroupBlock title="最近搜索" count={8} action={<GroupBlockAction>查看全部</GroupBlockAction>}>\n  <GroupBlockItem icon={MessageSquareTextIcon} title="…" description="…" extra="3 分钟前" render={<Link … />} />\n</GroupBlock>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用条目分组" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
