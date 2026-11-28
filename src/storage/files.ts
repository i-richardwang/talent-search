import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export function digest(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

type FileStore = {
	put(sha: string, bytes: Uint8Array): Promise<void>;
	get(sha: string): Promise<Uint8Array>;
	delete(sha: string): Promise<void>;
};

function location(sha: string) {
	if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("无效文件标识");
	const dir = resolve(process.env.TALENT_FILES_DIR?.trim() || ".talent-files");
	return { dir, path: join(dir, sha) };
}

export const files: FileStore = {
	async put(sha, bytes) {
		const { dir, path } = location(sha);
		await mkdir(dir, { recursive: true, mode: 0o700 });
		// 该内容的写入和回收持有同一把语料写锁。固定临时名让中断的写入也能回收。
		const temp = `${path}.partial`;
		try {
			await writeFile(temp, bytes, { flag: "w", mode: 0o600 });
			await rename(temp, path);
		} finally {
			await rm(temp, { force: true });
		}
	},
	get: (sha) => readFile(location(sha).path),
	async delete(sha) {
		const { path } = location(sha);
		await rm(path, { force: true });
		await rm(`${path}.partial`, { force: true });
	},
};
