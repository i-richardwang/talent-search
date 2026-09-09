import { XIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import type { SearchScope, SearchSpec } from "#/search/spec";
import { scopeEntries } from "../../../-lib/scope-label";

type Ranges = Pick<SearchSpec, "scope" | "prefer">;

/**
 * 原话中的结构化条件是查询本身的一部分，必须和语义条件一样可见、可删。
 *
 * 限制（`scope`）和偏好（`prefer`）是同一批维度的两种语气，画在同一排：偏好的
 * 那几枚带加号，和加分要求的 chip 用同一个记号（`query-chips.tsx` 的
 * `MODE_GLYPH`）——「最好是字节来的」和「最好带过团队」在用户嘴里是同一种话。
 */
export function QueryScope({
	scope,
	prefer,
	onChange,
}: Ranges & { onChange: (next: Ranges) => void }) {
	const entries = [
		...scopeEntries(scope).map((e) => ({
			...e,
			glyph: "",
			next: (without: SearchScope): Ranges => ({ scope: without, prefer }),
		})),
		...scopeEntries(prefer ?? {}).map((e) => ({
			...e,
			id: `prefer:${e.id}`,
			glyph: "+",
			next: (without: SearchScope): Ranges => ({ scope, prefer: without }),
		})),
	];
	if (entries.length === 0) return null;

	return (
		<fieldset aria-label="查询范围" className="flex gap-1.5 max-lg:flex-wrap">
			{entries.map(({ id, label, glyph, without, next }) => (
				<Button
					aria-label={`移除条件：${glyph ? `最好 ${label}` : label}`}
					key={id}
					onClick={() => onChange(next(without))}
					size="xs"
					variant="outline"
				>
					{glyph && (
						<span className="font-mono text-muted-foreground">{glyph}</span>
					)}
					{label}
					<XIcon />
				</Button>
			))}
		</fieldset>
	);
}
