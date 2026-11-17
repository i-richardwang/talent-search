import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { pool } from "../src/db";
import { listAccounts, manageAccount } from "../src/server/accounts";

const USAGE = `用法：
  bun run auth:user list
  bun run auth:user create --username 用户名 [--name 显示名称] [--role user|admin]
  bun run auth:user reset-password --username 用户名
  bun run auth:user set-role --username 用户名 --role user|admin
  bun run auth:user disable --username 用户名
  bun run auth:user enable --username 用户名`;

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		username: { type: "string" },
		name: { type: "string" },
		role: { type: "string" },
	},
});

/** 交互终端里问两遍密码，不回显，也不接受命令行参数。 */
async function askPassword(): Promise<string> {
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
	const ask = async (prompt: string) => {
		process.stdout.write(prompt);
		muted = true;
		try {
			return await terminal.question("");
		} finally {
			muted = false;
			process.stdout.write("\n");
		}
	};
	try {
		const password = await ask("密码（12–128 个字符）：");
		if (password !== (await ask("再输入一次：")))
			throw new Error("两次密码不一致，未作修改");
		return password;
	} finally {
		terminal.close();
	}
}

/** 做命令行说的那件事，返回要打印的内容。每个动作只收它用得上的参数，多了少了都给用法。 */
async function run(): Promise<string> {
	const [action, ...rest] = positionals;
	const { username, name, role } = values;
	const given = Object.keys(values).sort().join(" ");
	const takes = (...options: string[]) => {
		if (rest.length > 0 || given !== options.sort().join(" "))
			throw new Error(USAGE);
	};
	const need = (value: string | undefined) => {
		if (!value) throw new Error(USAGE);
		return value;
	};
	switch (action) {
		case "list": {
			takes();
			const lines: string[] = [];
			for (let page = 1, pages = 1; page <= pages; page++) {
				const table = await listAccounts("", page);
				pages = table.pages;
				for (const account of table.rows)
					lines.push(
						[
							account.username,
							account.name,
							account.admin ? "管理员" : "普通用户",
							account.disabled ? "已停用" : "",
						]
							.filter(Boolean)
							.join("\t"),
					);
			}
			return lines.join("\n");
		}
		case "create": {
			if (rest.length > 0) throw new Error(USAGE);
			const account = { action, username: need(username), name, role };
			const password = await askPassword();
			return `已创建账号：${await manageAccount({ ...account, password })}`;
		}
		case "reset-password": {
			takes("username");
			const account = { action, username: need(username) };
			const password = await askPassword();
			return `已重置密码并撤销全部登录：${await manageAccount({ ...account, password })}`;
		}
		case "set-role":
			takes("role", "username");
			return `已修改角色：${await manageAccount({
				action,
				username: need(username),
				role: need(role),
			})}`;
		case "disable":
			takes("username");
			return `已停用并撤销全部登录：${await manageAccount({
				action,
				username: need(username),
			})}`;
		case "enable":
			takes("username");
			return `已恢复：${await manageAccount({
				action,
				username: need(username),
			})}`;
		default:
			throw new Error(USAGE);
	}
}

try {
	console.log(await run());
} catch (error) {
	console.error(error instanceof Error ? error.message : "账号操作失败");
	process.exitCode = 1;
} finally {
	await pool.end();
}
