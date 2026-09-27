import { ChevronDownIcon, EyeOffIcon } from "lucide-react";
import {
	FilterChip,
	FilterChipClear,
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
	off = false,
}: {
	value: string;
	notes?: string[];
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
				<Chip notes={["+2"]} value="后端开发" />
				<Chip notes={["加分"]} value="带过团队" />
				<Chip notes={["排除"]} value="外包" />
				<Chip off value="沟通能力" />
				<Chip notes={["太宽"]} off value="互联网" />
			</div>
		</Stage>
	);
}

/** 条件药丸页：必须、多取值、加分、排除、停用、太宽几种样子。 */
export function FilterChipPage() {
	return (
		<DocPage
			facts={["32px", "半圆两端", "虚线表示停用"]}
			rules={{
				notes: [
					"名单上方的一排条件用 FilterChip，一条一枚，间隔 6px。",
					"点药丸打开这一条的菜单；右边的关闭格删掉这一条，菜单里不再重复删除。",
					"强度写成字跟在取值后面（FilterChipNote），必须是默认，不写。",
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
