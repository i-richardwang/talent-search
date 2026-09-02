import type { SearchScope } from "#/search/spec";

const ORDER: (keyof SearchScope)[] = [
	"kind",
	"minMonths",
	"companyTag",
	"level",
	"recruitment",
	"education",
	"org",
	"school",
];

export function scopeLabel(key: keyof SearchScope, value: string | number) {
	switch (key) {
		case "kind":
			return value === "internal" ? "公司内经历" : "入职前经历";
		case "minMonths":
			return `单段至少 ${value} 个月`;
		case "companyTag":
			return `公司档 · ${value}`;
		case "level":
			return `当前职级 · ${value}`;
		case "recruitment":
			return `招聘渠道 · ${value}`;
		case "education":
			return `学历 · ${value}`;
		case "org":
			return `组织 · ${value}`;
		case "school":
			return `学校 · ${value}`;
	}
}

export function scopeEntries(scope: SearchScope) {
	return ORDER.flatMap((key) => {
		const value = scope[key];
		return value === undefined ? [] : [{ key, value }];
	});
}
