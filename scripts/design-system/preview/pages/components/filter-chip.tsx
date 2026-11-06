import { ChevronDownIcon, EyeOffIcon } from "lucide-react";
import {
	FilterChip,
	FilterChipClear,
	FilterChipCount,
	FilterChipNote,
	FilterChipTrigger,
	FilterChipValue,
} from "#/components/ui/filter-chip";
import { Icon } from "#/components/ui/icon";
import { DocPage } from "../../kit/page";
import { Stage } from "../../kit/stage";

function Chip({
	value,
	notes = [],
	people,
	off = false,
}: {
	value: string;
	notes?: string[];
	people?: number;
	off?: boolean;
}) {
	return (
		<FilterChip dashed={off}>
			<FilterChipTrigger>
				{off && <Icon icon={EyeOffIcon} size={12} />}
				<FilterChipValue>{value}</FilterChipValue>
				{notes.map((note) => (
					<FilterChipNote key={note}>{note}</FilterChipNote>
				))}
				{people !== undefined && <FilterChipCount>{people} 人</FilterChipCount>}
				<Icon icon={ChevronDownIcon} size={10} />
			</FilterChipTrigger>
			<FilterChipClear label={`删除条件「${value}」`} onClear={() => {}} />
		</FilterChip>
	);
}

function Playground() {
	return (
		<Stage
			footer={
				<>
					<span>32px 高，两端半圆</span>
					<span>悬停描边加深，关闭格悬停铺底</span>
				</>
			}
		>
			<div className="flex flex-wrap items-center gap-1.5">
				<Chip value="推荐算法" />
				<Chip people={186} value="在某甲科技做推荐系统的那段经历" />
				<Chip notes={["加分"]} people={97} value="带过团队" />
				<Chip notes={["排除"]} people={23} value="实习经历不算" />
				<Chip off value="沟通能力" />
			</div>
		</Stage>
	);
}

export function FilterChipPage() {
	return (
		<DocPage
			facts={["一条一枚", "半圆两端", "虚线表示停用"]}
			rules={{
				notes: [
					"名单上方的一排条件用 FilterChip，一条一枚，间隔 6px。",
					"点药丸打开这一条的菜单；右边的关闭格删掉这一条，菜单里没有删除项。",
					"强度写成字跟在取值后面（FilterChipNote），必须是默认，不写。",
					"人数（FilterChipCount）在开关的最右边、箭头前，弱一档的字色，数字等宽；没有人数就不放。",
				],
				usage: `<FilterChip dashed={off}>
  <DropdownMenuRoot>
    <DropdownMenuTrigger>
      <FilterChipTrigger>…</FilterChipTrigger>
    </DropdownMenuTrigger>
    …
  </DropdownMenuRoot>
  <FilterChipClear label="删除条件「推荐算法」" onClear={remove} />
</FilterChip>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "几种样子" },
			]}
		/>
	);
}
