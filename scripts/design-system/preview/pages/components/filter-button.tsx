import {
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { FilterButton } from "#/components/ui/filter-button";
import { DocPage } from "../../kit/page";
import { Stage } from "../../kit/stage";

function Playground() {
	return (
		<Stage
			footer={
				<>
					<span>24px 高，两端全圆，12px 字</span>
					<span>悬停、菜单开着、选了东西时正文色字、二级填充</span>
				</>
			}
		>
			<div className="flex flex-wrap items-center gap-1">
				<FilterButton>序列</FilterButton>
				<FilterButton active>职级：M1/D7</FilterButton>
				<FilterButton active>学历：2 项</FilterButton>
				<DropdownMenuRoot>
					<DropdownMenuTrigger>
						<FilterButton>招聘渠道</FilterButton>
					</DropdownMenuTrigger>
					<DropdownMenuPortal>
						<DropdownMenuPositioner>
							<DropdownMenuPopup>
								{renderDropdownMenuItems([
									{
										checked: true,
										extra: 42,
										key: "social",
										label: "社招",
										onCheckedChange: () => {},
										type: "checkbox",
									},
									{
										checked: false,
										extra: 17,
										key: "campus",
										label: "校招",
										onCheckedChange: () => {},
										type: "checkbox",
									},
									{
										checked: false,
										disabled: true,
										extra: 0,
										key: "intern",
										label: "实习转正",
										onCheckedChange: () => {},
										type: "checkbox",
									},
								])}
							</DropdownMenuPopup>
						</DropdownMenuPositioner>
					</DropdownMenuPortal>
				</DropdownMenuRoot>
			</div>
		</Stage>
	);
}

/** 筛选钮页：没选、选了一项、选了几项，和点开的菜单。 */
export function FilterButtonPage() {
	return (
		<DocPage
			facts={["24px", "全圆", "选了东西铺底"]}
			rules={{
				notes: [
					"名单上方的筛选一维一个 FilterButton，间隔 4px，是下拉菜单的触发器。",
					"钮上写维度名；选了一项跟那一项，选了几项写几项。",
					"菜单里多选是勾选项、单选是单选项，行尾写选了之后还剩几个人。",
				],
				usage: `<DropdownMenuRoot>
  <DropdownMenuTrigger>
    <FilterButton active={values.length > 0}>职级：M1/D7</FilterButton>
  </DropdownMenuTrigger>
  …
</DropdownMenuRoot>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "几种样子" },
			]}
		/>
	);
}
