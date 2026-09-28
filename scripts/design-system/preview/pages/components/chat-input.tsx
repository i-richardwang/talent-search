import { Building2Icon, MessageSquareTextIcon } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Block } from "#/components/ui/block";
import {
	ChatInput,
	ChatInputAction,
	ChatInputArea,
	ChatInputBar,
	ChatInputSend,
} from "#/components/ui/chat-input";
import { Checkbox } from "#/components/ui/checkbox";
import { Hotkey } from "#/components/ui/hotkey";
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

type Size = NonNullable<ComponentProps<typeof ChatInput>["size"]>;

const SIZES: Size[] = ["middle", "large"];

const PLACEHOLDER: Record<Size, string> = {
	large: "描述你要找的人，例如：做过推荐算法、带过团队",
	middle: "补充或修改需求，例如：最好带过团队",
};

function Composer({
	size,
	loading = false,
	action = false,
}: {
	size: Size;
	loading?: boolean;
	/** 动作栏左端放一个按钮，首页的搜索方式就是它。 */
	action?: boolean;
}) {
	const [draft, setDraft] = useState("");
	return (
		<ChatInput className="w-full" size={size}>
			<ChatInputArea
				aria-label="描述需求"
				hint={
					size === "middle" && (
						<span className="inline-flex items-center">
							按<Hotkey keys="shift+enter" variant="borderless" />
							换行
						</span>
					)
				}
				onChange={(event) => setDraft(event.target.value)}
				placeholder={PLACEHOLDER[size]}
				value={draft}
			/>
			<ChatInputBar
				left={
					action && (
						<>
							<ChatInputAction
								chevron
								icon={MessageSquareTextIcon}
								variant="mode"
							>
								AI 搜索
							</ChatInputAction>
							<ChatInputAction chevron icon={Building2Icon}>
								公司或部门
							</ChatInputAction>
						</>
					)
				}
				right={
					<ChatInputSend
						aria-label="搜索"
						disabled={draft.trim() === ""}
						loading={loading}
						type="button"
					/>
				}
			/>
		</ChatInput>
	);
}

function Playground() {
	const [size, setSize] = useState<Size>("large");
	const [loading, setLoading] = useState(false);
	const [action, setAction] = useState(true);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="尺寸">
					<Segmented<Size>
						onChange={setSize}
						options={SIZES.map((value) => ({ label: value, value }))}
						value={size}
					/>
				</Control>
				<Control>
					<Checkbox checked={action} onChange={setAction}>
						动作栏按钮
					</Checkbox>
				</Control>
				<Control>
					<Checkbox checked={loading} onChange={setLoading}>
						提交中
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				footer={
					<span className="font-mono">
						{[size, action && "action", loading && "loading"]
							.filter(Boolean)
							.join(" · ")}
					</span>
				}
			>
				<div className="w-full max-w-page">
					<Composer action={action} key={size} loading={loading} size={size} />
				</div>
			</Stage>
		</div>
	);
}

function Sizes() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>尺寸</TableHead>
						<TableHead className="w-full">ChatInput</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{SIZES.map((size) => (
						<TableRow key={size}>
							<TableCell className="font-mono text-xs">{size}</TableCell>
							<TableCell>
								<Composer size={size} />
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
				description="首页写第一句用 large：圆角大一档，文本区更高，发送钮是圆的，托着一层铺开的远影；动作栏左端是搜索方式。"
				title="首页的输入面"
			>
				<Composer action size="large" />
			</Example>
			<Example
				description="右栏线程底下补充下一句用 middle。"
				title="补充下一句"
			>
				<Composer size="middle" />
			</Example>
		</ExampleGrid>
	);
}

export function ChatInputPage() {
	return (
		<DocPage
			facts={[`${SIZES.length} 种尺寸`, "动作栏按钮", "提交中"]}
			rules={{
				notes: [
					"两种搜索的输入面都是 ChatInput：一句话经由 QueryBar，关键词经由 KeywordBar，不另拼一个框。",
					"一段文字用 ChatInputArea，别的内容（关键词的标签和输入）用 ChatInputBody，空着时的那句话用 ChatInputPlaceholder；空着时多高、发送钮什么形状由 ChatInput 的 size 定，middle 两行起。",
					"文本区随内容长高，到上限后在里面滚动；middle 的占位后面跟换行的快捷键（hint）。",
					"动作栏左端放附加的动作，一律用 ChatInputAction；点开菜单或弹层的带 chevron。切换搜索方式的那一个用 mode，写着当前取值的（公司或部门、学校、累计年限）用缺省的 value。",
					"聚焦时面不变色，光标就是焦点；面上不另加聚焦边或环。",
					"发送钮放在 ChatInputBar 的 right；提交中给 loading，换成转圈并按不下去。",
					"large 只用在首页那一块，其余都是 middle。",
				],
				usage: `<ChatInput size="large">\n  <ChatInputArea aria-label="描述需求" placeholder="描述你要找的人" />\n  <ChatInputBar right={<ChatInputSend aria-label="搜索" />} />\n</ChatInput>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用输入托盘" },
				{ children: <Sizes />, id: "appearance", title: "尺寸" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
