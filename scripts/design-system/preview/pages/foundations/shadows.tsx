import { Block } from "#/components/ui/block";
import { SHADOW_TOKENS } from "../../../shared/tokens/registry";
import { DocPage } from "../../kit/page";
import { TokenName } from "../../kit/token-name";

/** 阴影页：令牌表里的每一档投影画在一块描边的面上，面上写它的读者。 */
export function ShadowsPage() {
	return (
		<DocPage
			facts={[`${SHADOW_TOKENS.length} 个投影令牌`]}
			sections={[
				{
					children: (
						<div className="grid grid-cols-3 gap-6 max-md:grid-cols-1">
							{SHADOW_TOKENS.map(({ key, label, use }) => (
								<div className="flex flex-col gap-4" key={key}>
									<Block
										align="center"
										className="h-32 text-center text-fg-tertiary text-xs"
										justify="center"
										padding={16}
										style={{ boxShadow: `var(${key})` }}
										variant="outlined"
									>
										{use}
									</Block>
									<TokenName name={label} token={key} />
								</div>
							))}
						</div>
					),
					id: "scale",
					title: "档位",
				},
			]}
		/>
	);
}
