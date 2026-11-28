import { useId } from "react";
import { Input } from "#/components/ui/input";
import type { Touch } from "#/ingestion/touch";

export const emptyTouch: Touch = { touched: null, notes: "" };
export function TouchFields({
	value,
	onChange,
}: {
	value: Touch;
	onChange: (value: Touch) => void;
}) {
	const id = useId();
	return (
		<div className="grid gap-2 sm:grid-cols-2">
			<label htmlFor={`${id}-date`}>
				接触日期
				<Input
					id={`${id}-date`}
					type="date"
					value={value.touched ?? ""}
					onChange={(e) =>
						onChange({ ...value, touched: e.target.value || null })
					}
				/>
			</label>
			<label htmlFor={`${id}-notes`}>
				接触备注
				<Input
					id={`${id}-notes`}
					maxLength={2000}
					value={value.notes}
					onChange={(e) => onChange({ ...value, notes: e.target.value })}
				/>
			</label>
		</div>
	);
}
