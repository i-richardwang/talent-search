/** 把用户文本收窄成 PostgreSQL LIKE / ILIKE 中的字面量。 */
export function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, "\\$&");
}
