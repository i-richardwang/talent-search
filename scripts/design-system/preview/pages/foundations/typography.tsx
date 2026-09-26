import { Block } from "#/components/ui/block";
import { numericTokens } from "../../../shared/tokens/registry";
import { DocPage } from "../../kit/page";
import { TokenName } from "../../kit/token-name";
import { useTokenNumber } from "../../state";

/** 两种字体：令牌、名字与工具类。 */
const FONTS = [
	["--font-sans", "正文字体", "font-sans"],
	["--font-mono", "等宽字体", "font-mono"],
] as const;

const TEXT_CLASS: Record<string, string> = {
	"--text-2xl": "text-2xl",
	"--text-base": "text-base",
	"--text-lg": "text-lg",
	"--text-sm": "text-sm",
	"--text-xl": "text-xl",
	"--text-xs": "text-xs",
};

export function TypographyPage() {
	const px = useTokenNumber();
	const sizes = numericTokens("type").filter(
		(token) => !token.key.endsWith("line-height"),
	);
	return (
		<DocPage
			facts={[`${sizes.length} 档字号`, `${FONTS.length} 种字体`]}
			sections={[
				{
					children: (
						<Block gap={0} variant="outlined">
							{sizes.map((token) => (
								<div
									className="flex items-center gap-6 border-border-secondary border-b px-5 py-4 last:border-b-0"
									key={token.key}
								>
									<TokenName
										name={token.label}
										token={token.key}
										value={`${px(token.key)} / ${px(`${token.key}--line-height`)}px`}
									/>
									<p
										className={`min-w-0 flex-1 truncate ${TEXT_CLASS[token.key]}`}
									>
										找到做过支付风控的后端工程师 Talent 0123
									</p>
								</div>
							))}
						</Block>
					),
					id: "scale",
					title: "字阶",
				},
				{
					children: (
						<div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
							{FONTS.map(([token, name, className]) => (
								<Block gap={12} key={token} padding={20} variant="outlined">
									<TokenName name={name} token={token} />
									<p className={`${className} text-xl`}>
										人才搜索 Aa Gg 0123456789
									</p>
								</Block>
							))}
						</div>
					),
					id: "typeface",
					title: "字体",
				},
				{
					children: (
						<Block gap={0} variant="outlined">
							{(
								[
									["常规 400", "font-normal"],
									["中粗 500", "font-medium"],
									["半粗 600", "font-semibold"],
								] as const
							).map(([name, className]) => (
								<div
									className="flex items-center gap-6 border-border-secondary border-b px-5 py-4 last:border-b-0"
									key={name}
								>
									<span className="w-44 text-fg-secondary text-xs">{name}</span>
									<p className={`text-lg ${className}`}>
										候选人名单 · 简历自述
									</p>
								</div>
							))}
						</Block>
					),
					id: "weight",
					title: "字重",
				},
			]}
		/>
	);
}
