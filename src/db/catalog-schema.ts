/**
 * 目录所在的 schema。生产是 `catalog`（`db/schema.ts`）；同一个库里要放几套目录时（比如每个
 * 测试文件一套）用 `TALENT_CATALOG_SCHEMA` 指定。
 */
export function catalogSchema(): string {
	const name = process.env.TALENT_CATALOG_SCHEMA?.trim() || "catalog";
	if (!/^[a-z_][a-z0-9_]*$/.test(name))
		throw new Error(`TALENT_CATALOG_SCHEMA 不是合法的 schema 名：${name}`);
	return name;
}
