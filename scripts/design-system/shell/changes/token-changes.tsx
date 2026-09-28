import { CircleCheck, RotateCcw } from "lucide-react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Empty } from "#/components/ui/empty";
import { parseColor } from "../../shared/color";
import { Swatch } from "../../shared/marks";
import { originalValue } from "../../shared/source";
import {
	type Draft,
	draftEntries,
	resetTokens,
} from "../../shared/tokens/draft";
import { SCOPE_LABEL, tokenLabel } from "../../shared/tokens/registry";

/** 没有修改时各处都说的这一句。 */
export const UNCHANGED = "没有修改";

/** 没有修改时的空态；`description` 说这一页在有修改时列什么。 */
export function Unchanged({ description }: { description?: string }) {
	return (
		<Empty description={description} icon={CircleCheck} title={UNCHANGED} />
	);
}

/** 一个值：颜色前面带色块。 */
function Value({ value }: { value: string }) {
	return (
		<span className="flex min-w-0 items-center gap-1.5">
			{parseColor(value) && <Swatch className="size-3.5" color={value} />}
			<code className="truncate">{value}</code>
		</span>
	);
}

/**
 * 当前的全部修改：每项写修改前（划掉）与修改后的值、作用在哪一侧，可以单独还原。
 */
export function TokenChanges({
	draft,
	onEdit,
}: {
	draft: Draft;
	onEdit: (draft: Draft) => void;
}) {
	const changes = draftEntries(draft);
	if (changes.length === 0)
		return <Unchanged description="调整令牌后，这里列出每一项修改。" />;
	return (
		<div className="flex flex-col">
			<p className="border-border-secondary border-b py-3 font-medium text-sm">
				{changes.length} 项修改
			</p>
			<ul className="flex flex-col">
				{changes.map(({ key, scope, value }) => (
					<li
						className="flex flex-col gap-1.5 border-border-secondary border-b py-3 text-xs last:border-b-0"
						key={`${scope}:${key}`}
					>
						<div className="flex items-center gap-2">
							<strong className="font-semibold">{tokenLabel(key)}</strong>
							<span className="ml-auto text-fg-tertiary">
								{SCOPE_LABEL[scope]}
							</span>
							<ActionIcon
								icon={RotateCcw}
								onClick={() => onEdit(resetTokens(draft, scope, [key]))}
								size="small"
								title={`还原${tokenLabel(key)}（${SCOPE_LABEL[scope]}）`}
							/>
						</div>
						<code className="text-fg-tertiary">{key}</code>
						<div className="mt-1 flex flex-col gap-1">
							<del className="block text-fg-tertiary decoration-fg-quaternary">
								<Value value={originalValue(scope, key) ?? ""} />
							</del>
							<Value value={value} />
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
