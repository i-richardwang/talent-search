/** 一行令牌：名字、变量与现在的值。 */
export function TokenName({
	name,
	token,
	value,
}: {
	name: string;
	token: string;
	value?: string;
}) {
	return (
		<div className="flex w-44 shrink-0 flex-col gap-0.5 text-xs">
			<span className="font-medium">{name}</span>
			<code className="text-fg-tertiary">{token}</code>
			{value && <span className="text-fg-tertiary tabular-nums">{value}</span>}
		</div>
	);
}
