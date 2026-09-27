import { MessageSquareTextIcon, PlusIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
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

/** 托盘上沿的一片：一条替代条件和它的「添加」。 */
function Offer() {
	return (
		<div className="flex items-center gap-2">
			<span className="min-w-0 flex-1">
				「技术口碑好」可改为：做过技术分享（加分）
			</span>
			<Button className="shrink-0" icon={PlusIcon} size="small" type="text">
				添加
			</Button>
		</div>
	);
}

/** 一块托盘：文本区、动作栏和发送钮，框里空着时发送钮按不下去。 */
function Composer({
	size,
	tray,
	loading = false,
	action = false,
}: {
	size: Size;
	tray?: ReactNode;
	loading?: boolean;
	/** 动作栏左端放一个按钮，首页的搜索方式就是它。 */
	action?: boolean;
}) {
	const [draft, setDraft] = useState("");
	return (
		<ChatInput className="w-full" size={size} tray={tray}>
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
						<ChatInputAction chevron icon={MessageSquareTextIcon}>
							AI 搜索
						</ChatInputAction>
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
	const [tray, setTray] = useState(false);
	const [loading, setLoading] = useState(false);
	const [action, setAction] = useState(true);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="尺寸">
					<Segmented<Size> onChange={setSize} options={SIZES} value={size} />
				</Control>
				<Control>
					<Checkbox checked={tray} onChange={setTray}>
						上沿一片
					</Checkbox>
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
						{[size, tray && "tray", action && "action", loading && "loading"]
							.filter(Boolean)
							.join(" · ")}
					</span>
				}
			>
				<div className="w-full max-w-page">
					<Composer
						action={action}
						key={size}
						loading={loading}
						size={size}
						tray={tray && <Offer />}
					/>
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
					<TableRow>
						<TableCell className="whitespace-nowrap font-mono text-xs">
							middle · tray
						</TableCell>
						<TableCell>
							<Composer size="middle" tray={<Offer />} />
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
				description="首页写第一句用 large：圆角大一档，文本区更高，发送钮是圆的，托着一层铺开的远影；动作栏左端是搜索方式。"
				title="首页的输入面"
			>
				<Composer action size="large" />
			</Example>
			<Example
				description="右栏线程底下补充下一句用 middle；搜不了的要求附带的替代条件挂在上沿，点「添加」就加进条件。"
				title="补充下一句"
			>
				<Composer size="middle" tray={<Offer />} />
			</Example>
		</ExampleGrid>
	);
}

/** 输入托盘页：试用、尺寸、使用场景。 */
export function ChatInputPage() {
	return (
		<DocPage
			facts={[`${SIZES.length} 种尺寸`, "上沿一片", "动作栏按钮", "提交中"]}
			rules={{
				notes: [
					"两种搜索的输入面都是 ChatInput：一句话经由 QueryBar，关键词经由 KeywordBar，不另拼一个框。",
					"一段文字用 ChatInputArea，别的内容（关键词的标签和输入）用 ChatInputBody，空着时的那句话用 ChatInputPlaceholder；空着时多高、发送钮什么形状由 ChatInput 的 size 定，middle 两行起。",
					"文本区随内容长高，超过 20rem 在里面滚动；占位是 fg-tertiary 的一句话，middle 后面跟换行的快捷键（hint）。",
					"动作栏左端放附加的动作，一律用 ChatInputAction：12px 次要色的文字按钮，悬停时字变深、铺 fill-secondary；点开菜单或弹层的带 chevron。首页是搜索方式，关键词还有公司或部门、学校、累计年限。",
					"聚焦时面不变色，光标就是焦点；面上不另加聚焦边或环。",
					"发送钮放在 ChatInputBar 的 right；提交中给 loading，换成转圈并按不下去。",
					"tray 只放作用在这句话之前、点一下就能办的事。",
					"large 只用在首页那一块，其余都是 middle。",
				],
				usage: `<ChatInput size="large" tray={offers}>\n  <ChatInputArea aria-label="描述需求" placeholder="描述你要找的人" />\n  <ChatInputBar right={<ChatInputSend aria-label="搜索" />} />\n</ChatInput>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用输入托盘" },
				{ children: <Sizes />, id: "appearance", title: "尺寸" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
