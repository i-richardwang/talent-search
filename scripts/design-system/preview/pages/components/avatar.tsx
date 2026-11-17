import { useState } from "react";
import { Avatar } from "#/components/ui/avatar";
import { Input } from "#/components/ui/input";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";

/** 产品里用到的两种边长：导航栏的当前账号，账号菜单的上栏。 */
const SIZES = [28, 36];

function Playground() {
	const [seed, setSeed] = useState("hr_user");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="用户名">
					<Input
						onChange={(event) => setSeed(event.target.value)}
						value={seed}
					/>
				</Control>
			</Controls>
			<Stage>
				{SIZES.map((size) => (
					<Avatar key={size} seed={seed} size={size} />
				))}
			</Stage>
		</div>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="每个用户名一张，换一个字就是另一张；同一个用户名在哪儿、深浅哪一侧都是同一张。"
				title="一人一张"
			>
				<Avatar seed="hr_user" size={36} />
				<Avatar seed="hr_user2" size={36} />
				<Avatar seed="admin" size={36} />
				<Avatar seed="former_user" size={36} />
			</Example>
			<Example
				description="头像总是跟着名字：账号菜单上栏是 36 的头像、名字和用户名。"
				title="账号菜单的上栏"
			>
				<div className="flex items-center gap-2.5">
					<Avatar seed="hr_user" size={36} />
					<div>
						<p className="font-semibold">招聘同事</p>
						<p className="text-fg-secondary text-xs">hr_user</p>
					</div>
				</div>
			</Example>
		</ExampleGrid>
	);
}

export function AvatarPage() {
	return (
		<DocPage
			facts={["方形", "按用户名生成", "边长可调"]}
			rules={{
				notes: [
					"头像只用在当前账号上：导航栏左上角 28，账号菜单上栏 36。",
					"没有上传图片，按用户名生成一张像素图（boring-avatars 的 pixel，和 lobe-ui 同一组固定配色）；用户名唯一，改显示名称不换头像。",
					"配色是固定的五个色值，不读令牌：同一个人在深浅两侧是同一张。",
					"圆角是边长的六分之一，随 size 一起变，不在调用处覆盖。",
					"头像旁边总有名字，读屏跳过头像。",
				],
				usage: `<Avatar seed={user.username} size={28} />`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用头像" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
