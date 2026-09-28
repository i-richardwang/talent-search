import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { SearchBar } from "#/components/ui/search-bar";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

function Searchable({
	placeholder,
	label,
	initial = "",
	onSearched,
	...props
}: {
	placeholder: string;
	label: string;
	initial?: string;
	onSearched?: (q: string) => void;
	loading?: boolean;
}) {
	const [value, setValue] = useState(initial);
	return (
		<SearchBar
			aria-label={label}
			className="w-full max-w-96"
			onChange={setValue}
			onSearch={(q) => onSearched?.(q)}
			placeholder={placeholder}
			value={value}
			{...props}
		/>
	);
}

function Playground() {
	const [searched, setSearched] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control>
					<Checkbox checked={loading} onChange={setLoading}>
						搜索中
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<span>
						{searched === null
							? "回车搜索，有字时末尾可以清空"
							: searched
								? `搜索了「${searched}」`
								: "清空了，列出全部"}
					</span>
				}
			>
				<Searchable
					label="搜索技能"
					loading={loading}
					onSearched={setSearched}
					placeholder="搜索技能、写法或所属的词"
				/>
			</Stage>
		</div>
	);
}

function States() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>空 · 快捷键</TableHead>
						<TableHead>有字 · 可清空 · 搜索中</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell>
							<Searchable label="搜索技能" placeholder="搜索技能" />
						</TableCell>
						<TableCell>
							<Searchable
								initial="推荐系统"
								label="搜索技能"
								loading
								placeholder="搜索技能"
							/>
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="技能页的表上方：按词、写法或所属的词找，回车换一页结果。"
				title="技能页找词"
			>
				<Searchable label="搜索技能" placeholder="搜索技能、写法或所属的词" />
			</Example>
			<Example
				description="数据页的表上方，框里是地址上那一次搜索的词，清空就回到整张表。"
				title="数据页找人"
			>
				<Searchable
					initial="Talent 01"
					label="搜索姓名或工号"
					placeholder="搜索姓名或工号"
				/>
			</Example>
		</ExampleGrid>
	);
}

export function SearchBarPage() {
	return (
		<DocPage
			facts={["回车搜索", "可清空", "快捷键聚焦"]}
			rules={{
				notes: [
					"表上方找词用 SearchBar：回车就搜，有字时末尾出现清空，没有「搜索」按钮。",
					"框里的字受控；地址上的词变了（后退、前进）时，调用处把它同步回框里。",
					"宽度属于外层布局，常用 max-w-96。",
					"结果还在取时给 loading，前面的搜索图标换成转圈，框照常可输入。",
					"按 mod+k 把焦点移进框里，所以一页只放一个 SearchBar；框空着、没焦点时右端提示这组键。",
				],
				usage: `<SearchBar\n  aria-label="搜索技能"\n  onChange={setNeedle}\n  onSearch={(q) => navigate({ search: { q } })}\n  placeholder="搜索技能、写法或所属的词"\n  value={needle}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用搜索框" },
				{ children: <States />, id: "states", title: "状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
