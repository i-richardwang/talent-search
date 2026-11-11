/**
 * 测试临时 schema 的名字：建它的进程号加一段随机串。夹具照它起名（`fixture.ts`），
 * 启动脚本照它认出被中断的测试留下的 schema（`scripts/test.ts`）。
 */

import { randomBytes } from "node:crypto";

const PREFIX = "talent_test_";
const NAMED = new RegExp(`^${PREFIX}(\\d+)_[0-9a-f]{8}(_catalog)?$`);

/** 给当前进程起一个新的临时 schema 名。 */
export function tempSchema(): string {
	return `${PREFIX}${process.pid}_${randomBytes(4).toString("hex")}`;
}

/** 这个临时 schema 的数据目录用的 schema 名。 */
export function catalogOf(schema: string): string {
	return `${schema}_catalog`;
}

/** 建这个 schema 的进程号；不是测试临时 schema 时为 null。 */
export function ownerOf(schema: string): number | null {
	const pid = NAMED.exec(schema)?.[1];
	return pid === undefined ? null : Number(pid);
}
