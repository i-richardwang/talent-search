import { useState } from "react";
import { SearchBar } from "#/components/ui/search-bar";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 一个受控的搜索框，搜过的词写在读数条上。 */
function Searchable({
	placeholder,
	label,
	initial = "",
	onSearched,
}: {
	placeholder: string;
	label: string;
	initial?: string;
	onSearched?: (q: string) => void;
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
		/>
	);
}

function Playground() {
	const [searched, setSearched] = useState<string | null>(null);
	return (
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
				onSearched={setSearched}
				placeholder="搜索技能、写法或所属的词"
			/>
		</Stage>
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

/** 搜索框页：试用、产品里的两处用法。 */
export function SearchBarPage() {
	return (
		<DocPage
			facts={["回车搜索", "可清空"]}
			rules={{
				notes: [
					"表上方找词用 SearchBar：回车就搜，有字时末尾出现清空，没有「搜索」按钮。",
					"框里的字受控；地址上的词变了（后退、前进）时，调用处把它同步回框里。",
					"宽度属于外层布局，常用 max-w-96。",
				],
				usage: `<SearchBar\n  aria-label="搜索技能"\n  onChange={setNeedle}\n  onSearch={(q) => navigate({ search: { q } })}\n  placeholder="搜索技能、写法或所属的词"\n  value={needle}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用搜索框" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
