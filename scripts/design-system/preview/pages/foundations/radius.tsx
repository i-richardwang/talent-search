import { Search } from "lucide-react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import {
	ChatInput,
	ChatInputArea,
	ChatInputBar,
	ChatInputSend,
} from "#/components/ui/chat-input";
import { Input } from "#/components/ui/input";
import { Tag } from "#/components/ui/tag";
import { numericTokens } from "../../../shared/tokens/registry";
import { DocPage } from "../../kit/page";
import { TokenName } from "../../kit/token-name";
import { useTokenNumber } from "../../state";

const RADIUS_CLASS: Record<string, string> = {
	"--radius-lg": "rounded-lg",
	"--radius-md": "rounded-md",
	"--radius-sm": "rounded-sm",
	"--radius-xs": "rounded-xs",
	"--radius-xl": "rounded-xl",
};

export function RadiusPage() {
	const px = useTokenNumber();
	const radii = numericTokens("radius");
	return (
		<DocPage
			facts={[`${radii.length} 档圆角`]}
			sections={[
				{
					children: (
						<div className="grid grid-cols-5 gap-3.5 max-md:grid-cols-2">
							{radii.map((token) => (
								<Block gap={14} key={token.key} padding={20} variant="outlined">
									<div
										className={`h-20 border border-border bg-fill-tertiary ${RADIUS_CLASS[token.key]}`}
									/>
									<TokenName
										name={token.label}
										token={token.key}
										value={`${px(token.key)}px`}
									/>
								</Block>
							))}
						</div>
					),
					id: "scale",
					title: "档位",
				},
				{
					children: (
						<div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
							<Block gap={12} padding={20} variant="outlined">
								<span className="text-fg-secondary text-xs">特小：标签</span>
								<div className="flex gap-2">
									<Tag>后端</Tag>
									<Tag variant="outlined">支付</Tag>
								</div>
							</Block>
							<Block gap={12} padding={20} variant="outlined">
								<span className="text-fg-secondary text-xs">
									小：按钮、菜单项
								</span>
								<div className="flex gap-2">
									<Button type="primary">搜索</Button>
									<Button>清空</Button>
								</div>
							</Block>
							<Block gap={12} padding={20} variant="outlined">
								<span className="text-fg-secondary text-xs">
									基础：输入框、卡片
								</span>
								<Input
									aria-label="需求"
									placeholder="描述要找的人"
									prefix={<Search className="size-4 text-fg-tertiary" />}
								/>
							</Block>
							<Block gap={12} padding={20} variant="outlined">
								<span className="text-fg-secondary text-xs">
									大：对话框、内容卡片、输入托盘
								</span>
								<Block padding={16} shadow variant="outlined">
									<span className="text-sm">对话框的面板</span>
								</Block>
							</Block>
							<Block gap={12} padding={20} variant="outlined">
								<span className="text-fg-secondary text-xs">
									特大：首页的输入托盘
								</span>
								<ChatInput size="large">
									<ChatInputArea aria-label="需求" placeholder="描述要找的人" />
									<ChatInputBar right={<ChatInputSend aria-label="搜索" />} />
								</ChatInput>
							</Block>
						</div>
					),
					id: "usage",
					title: "用在哪里",
				},
			]}
		/>
	);
}
