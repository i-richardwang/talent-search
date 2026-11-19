/**
 * 组织：部门路径从最上一级（集团）写到一个部门，级与级之间是 `ORG_SEPARATOR`。账号的数据范围
 * 是几个组织，连同它们下面的各级（`db/schema.ts` 的 `MEMBERS`）。
 */

/** 部门路径里级与级之间的分隔，如「示例科技>技术中心>平台技术部」。 */
export const ORG_SEPARATOR = ">";

/** 规范的写法：每一级去掉首尾空白，空的级不算。 */
export const orgPathOf = (raw: string) =>
	raw
		.split(ORG_SEPARATOR)
		.map((level) => level.trim())
		.filter(Boolean)
		.join(ORG_SEPARATOR);

/** `path` 是 `org` 本身，或在它下面。 */
export const within = (path: string, org: string) =>
	`${path}${ORG_SEPARATOR}`.startsWith(`${org}${ORG_SEPARATOR}`);

/** 组织的名字：路径的最后一级。 */
export const orgName = (path: string) =>
	path.slice(path.lastIndexOf(ORG_SEPARATOR) + 1);

/**
 * 一个账号的几个组织：每个规范化，去掉重复的和被另一个包含的（选了集团再选它下面的部门，
 * 范围还是集团）。一个都没有、或有一个是空的为 null。
 */
export function orgsOf(raws: readonly string[]): string[] | null {
	const paths = raws.map(orgPathOf);
	if (paths.length === 0 || paths.some((p) => !p)) return null;
	const unique = [...new Set(paths)];
	return unique
		.filter((p) => !unique.some((other) => other !== p && within(p, other)))
		.sort();
}

/** 组织树上的一个节点：路径、名字、第几级（从 0 起）、此刻在它下面的人数。 */
export type OrgNode = {
	path: string;
	name: string;
	depth: number;
	people: number;
};

/**
 * 由每个部门路径此刻有多少人拼出组织树，按树的先序排：上级在前，下级按名字跟在后面。
 * 每个节点的人数连同它下面的各级。
 */
export function orgTree(
	paths: readonly { path: string; people: number }[],
): OrgNode[] {
	const people = new Map<string, number>();
	for (const { path, people: n } of paths) {
		const levels = path.split(ORG_SEPARATOR);
		for (let i = 1; i <= levels.length; i++) {
			const prefix = levels.slice(0, i).join(ORG_SEPARATOR);
			people.set(prefix, (people.get(prefix) ?? 0) + n);
		}
	}
	return [...people]
		.map(([path, n]) => ({
			path,
			name: orgName(path),
			depth: path.split(ORG_SEPARATOR).length - 1,
			people: n,
		}))
		.sort((a, b) => {
			const x = a.path.split(ORG_SEPARATOR);
			const y = b.path.split(ORG_SEPARATOR);
			for (let i = 0; i < Math.min(x.length, y.length); i++) {
				const order = (x[i] as string).localeCompare(
					y[i] as string,
					"zh-Hans-CN",
				);
				if (order !== 0) return order;
			}
			return x.length - y.length;
		});
}
