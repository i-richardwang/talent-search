/** 证据的文字投影：名单、依据气泡和导出共用，全部读取检索提供的段和累计依据。 */
import { dots, years } from "#/lib/format";
import { routeLabel } from "#/search/evidence";
import { type ClaimBasis, type Evidence, placeOf } from "#/search/result";

/** 命中的文字和它所在的岗位背景。 */
export function evidenceField(evidence: Evidence): {
	label: string;
	value: string | null;
	context: string;
} {
	const label = routeLabel(evidence.route);
	switch (evidence.route) {
		case "role":
			return {
				label,
				value: dots(evidence.title, placeOf(evidence)),
				context: evidence.seq,
			};
		case "title":
			return { label, value: evidence.title, context: placeOf(evidence) };
		case "description":
			return {
				label,
				value: null,
				context: dots(evidence.title, placeOf(evidence)),
			};
		case "skill":
			return {
				label,
				value:
					evidence.phrase === null
						? null
						: dots(evidence.engagement, evidence.phrase),
				context: dots(evidence.title, placeOf(evidence)),
			};
	}
}

/** 一段写其经历来源，多段写「累计」；时长始终是参与排名的累计值。 */
export function tenureOf(evidence: Evidence, basis: ClaimBasis) {
	return {
		label:
			basis.segments > 1
				? "累计"
				: evidence.kind === "external"
					? "入职前"
					: "公司内",
		duration: years(basis.months),
	};
}

/** 导出单元格里的文字，和依据气泡同一份内容。 */
export function evidenceText(evidence: Evidence, basis: ClaimBasis) {
	const field = evidenceField(evidence);
	const tenure = tenureOf(evidence, basis);
	return dots(
		[field.label, field.value ?? field.context].filter(Boolean).join(" "),
		field.value === null ? null : field.context,
		`${tenure.label} ${tenure.duration}`,
	);
}
