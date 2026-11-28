import { useState } from "react";
import { OrgPicker } from "#/components/org-picker";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { ORG_TREE } from "../../samples/admin";

/** 一块和对话框里一样宽的选择器，自己记着选了什么。 */
function Picker({
	initial = [],
	loading = false,
	single = false,
}: {
	initial?: string[];
	loading?: boolean;
	single?: boolean;
}) {
	const [value, setValue] = useState(initial);
	return (
		<div className="w-full max-w-sm">
			<OrgPicker
				single={single}
				onChange={setValue}
				tree={loading ? null : ORG_TREE}
				value={value}
			/>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="建账号时还没选：底下一行说至少选一个，选最上一级就是全部有部门的人。"
				title="还没选"
			>
				<Picker />
			</Example>
			<Example
				description="勾上「技术中心」，它下面的各级跟着勾上、不能单独取消；底下一行合计此刻的人数。"
				title="选了一个中心和另一处的一个部门"
			>
				<Picker
					initial={["示例科技>技术中心", "示例科技>增长中心>用户增长部"]}
				/>
			</Example>
			<Example
				description="对话框刚打开、组织树还没取回：框不能输入，树的位置是占位行。"
				title="组织树还在取"
			>
				<Picker loading />
			</Example>
			<Example
				title="人才池所属部门"
				description="选择一个部门后，持有该部门或上级范围的账号可访问人才池。"
			>
				<Picker single initial={["示例科技>技术中心"]} />
			</Example>
		</ExampleGrid>
	);
}

/** 组织树：账号页上选一个账号的数据范围。 */
export function OrgPickerPage() {
	return (
		<DocPage
			facts={["账号页的数据范围", "人才池的所属部门"]}
			rules={{
				notes: [
					"树按此刻的部门路径拼出来，每个组织后面是此刻在它下面的人数；默认展开最上一级。",
					"勾上一个组织就连同它下面的各级，下面的各级显示为勾上且不能单独取消。",
					"上面的框按名字找，找到的平铺、写完整路径，最多列 50 个。",
					"底下一行写选了几个组织、一共多少人；一个都没选时提示至少选一个。",
				],
				usage: `<OrgPicker tree={tree} value={orgs} onChange={setOrgs} />`,
			}}
			sections={[
				{
					children: (
						<Stage>
							<Picker initial={["示例科技>出行事业部"]} />
						</Stage>
					),
					id: "playground",
					title: "试用组织树",
				},
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
