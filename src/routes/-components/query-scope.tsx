import { XIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import type { SearchScope } from "#/search/spec";
import { scopeEntries, scopeLabel } from "../-lib/scope-label";

/** 原话中的结构化条件是查询本身的一部分，必须和语义条件一样可见、可删。 */
export function QueryScope({
	scope,
	onChange,
}: {
	scope: SearchScope;
	onChange: (scope: SearchScope) => void;
}) {
	const entries = scopeEntries(scope);
	if (entries.length === 0) return null;

	return (
		<fieldset aria-label="查询范围" className="flex flex-wrap gap-1.5">
			{entries.map(({ key, value }) => (
				<Button
					aria-label={`移除条件：${scopeLabel(key, value)}`}
					key={key}
					onClick={() => {
						const next = { ...scope };
						delete next[key];
						onChange(next);
					}}
					size="xs"
					variant="outline"
				>
					{scopeLabel(key, value)}
					<XIcon />
				</Button>
			))}
		</fieldset>
	);
}
