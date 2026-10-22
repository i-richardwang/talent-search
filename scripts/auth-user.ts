import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { pool } from "../src/db";
import { manageAccount } from "../src/server/accounts";

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		username: { type: "string" },
		name: { type: "string" },
		role: { type: "string" },
	},
});

try {
	const action = positionals[0];
	if (
		positionals.length !== 1 ||
		(action !== "create" && action !== "reset-password") ||
		!values.username
	)
		throw new Error(
			"用法：bun run auth:user create|reset-password --username 用户名 [--name 显示名称] [--role user|admin]",
		);
	if (action === "reset-password" && (values.role || values.name))
		throw new Error("重置密码不修改名称或角色");
	if (!process.stdin.isTTY)
		throw new Error("请在交互终端运行，密码不会回显，也不接受命令行参数");
	let muted = false;
	const output = new Writable({
		write(chunk, _encoding, done) {
			if (!muted) process.stdout.write(chunk);
			done();
		},
	});
	const terminal = createInterface({
		input: process.stdin,
		output,
		terminal: true,
	});
	const askPassword = async (prompt: string) => {
		process.stdout.write(prompt);
		muted = true;
		try {
			return await terminal.question("");
		} finally {
			muted = false;
			process.stdout.write("\n");
		}
	};
	let password: string;
	try {
		password = await askPassword("密码（12–128 个字符）：");
		if (password !== (await askPassword("再输入一次：")))
			throw new Error("两次密码不一致，未作修改");
	} finally {
		terminal.close();
	}
	const result = await manageAccount({
		action,
		username: values.username,
		password,
		name: values.name,
		role: values.role,
	});
	console.log(
		action === "create"
			? `已创建账号：${result.username}`
			: `已重置密码并撤销全部会话：${result.username}`,
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : "账号操作失败");
	process.exitCode = 1;
} finally {
	await pool.end();
}
