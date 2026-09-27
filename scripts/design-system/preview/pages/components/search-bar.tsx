import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import type { InputSize, InputVariant } from "#/components/ui/input";
import { SearchBar } from "#/components/ui/search-bar";
import { Segmented } from "#/components/ui/segmented";
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

type VariantChoice = InputVariant | "auto";

const VARIANTS: VariantChoice[] = ["auto", "filled", "outlined", "borderless"];
const SIZES: InputSize[] = ["middle", "small"];

const variantOf = (choice: VariantChoice) =>
	choice === "auto" ? undefined : choice;

/** 一个受控的搜索框，搜过的词写在读数条上。 */
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
	size?: InputSize;
	variant?: InputVariant;
	allowClear?: boolean;
	loading?: boolean;
	shortKey?: string;
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
	const [variant, setVariant] = useState<VariantChoice>("auto");
	const [size, setSize] = useState<InputSize>("middle");
	const [allowClear, setAllowClear] = useState(true);
	const [loading, setLoading] = useState(false);
	const [shortKey, setShortKey] = useState(true);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="外观">
					<Segmented<VariantChoice>
						onChange={setVariant}
						options={VARIANTS}
						value={variant}
					/>
				</Control>
				<Control label="尺寸">
					<Segmented<InputSize>
						onChange={setSize}
						options={SIZES}
						value={size}
					/>
				</Control>
				<Control>
					<Checkbox checked={allowClear} onChange={setAllowClear}>
						可清空
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={loading} onChange={setLoading}>
						搜索中
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={shortKey} onChange={setShortKey}>
						快捷键 mod+k
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
					allowClear={allowClear}
					label="搜索技能"
					loading={loading}
					onSearched={setSearched}
					placeholder="搜索技能、写法或所属的词"
					shortKey={shortKey ? "k" : undefined}
					size={size}
					variant={variantOf(variant)}
				/>
			</Stage>
		</div>
	);
}

function Appearances() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>外观</TableHead>
						<TableHead>空 · 快捷键</TableHead>
						<TableHead>有字 · 可清空 · 搜索中</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{VARIANTS.map((choice) => (
						<TableRow key={choice}>
							<TableCell className="font-mono text-xs">
								{choice === "auto" ? "自动" : choice}
							</TableCell>
							<TableCell>
								<Searchable
									label="搜索技能"
									placeholder="搜索技能"
									shortKey="k"
									variant={variantOf(choice)}
								/>
							</TableCell>
							<TableCell>
								<Searchable
									initial="推荐系统"
									label="搜索技能"
									loading
									placeholder="搜索技能"
									variant={variantOf(choice)}
								/>
							</TableCell>
						</TableRow>
					))}
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

/** 搜索框页：试用、产品里的两处用法。 */
export function SearchBarPage() {
	return (
		<DocPage
			facts={[
				"回车搜索",
				"可清空",
				`${VARIANTS.length} 种外观`,
				`${SIZES.length} 种尺寸`,
				"快捷键聚焦",
			]}
			rules={{
				notes: [
					"表上方找词用 SearchBar：回车就搜，有字时末尾出现清空，没有「搜索」按钮。",
					"框里的字受控；地址上的词变了（后退、前进）时，调用处把它同步回框里。",
					"宽度属于外层布局，常用 max-w-96。",
					"size、variant 与 Input 同一套：页头 44px 那一条里用 small 加 filled。",
					"结果还在取时给 loading，前面的搜索图标换成转圈，框照常可输入。",
					"整页只有这一个找词的地方时给 shortKey（k 等于 mod+k），按下就把焦点移进框里；框空着、没焦点时右端提示这组键。",
				],
				usage: `<SearchBar\n  aria-label="搜索技能"\n  onChange={setNeedle}\n  onSearch={(q) => navigate({ search: { q } })}\n  placeholder="搜索技能、写法或所属的词"\n  value={needle}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用搜索框" },
				{ children: <Appearances />, id: "appearance", title: "外观与状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
