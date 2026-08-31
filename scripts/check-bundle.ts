/**
 * 客户端 bundle 里不许出现服务端才有的东西：npm run build 之后跑。
 *
 * `tests/boundary.test.ts` 从 import 图那一侧防同一件事，但它是**静态启发式**：
 * 它信任 `RPC_BOUNDARY` 里的文件「handler 会被切走」，而插件切走的只是 handler
 * 的函数体——同一个文件里 handler 之外的代码照进 bundle。往那个集合里多加一个
 * 名字，这道防线就在那个文件上失效了。
 *
 * 这里查的是构建产物本身，不做任何推断，所以绕不过去。
 *
 * 框架自带的 importProtection 顶不了这一道：实测把它设成 `behavior: "error"`，
 * 一个 handler 之外引用 `db` 的导出照样构建通过（Start 1.168）。它管的是
 * `node:*` 内建和显式标记的服务端文件，不是「服务端模块的值漏到 handler 外」。
 *
 * 为什么必须有人查：泄漏的表现是 `db/index.ts` 顶层的 `new Pool()` 和
 * `if (!DATABASE_URL) throw` 被打进客户端主 chunk，浏览器一求值就抛，水合
 * 整个不发生。而 SSR 跑在 Node 里，直出的 HTML 一切正常——curl 看不出来，
 * tsc、biome、build、测试也全绿。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 每一条都只可能来自服务端模块，且不会作为普通词出现在页面代码里。 */
const FORBIDDEN = [
	"DATABASE_URL", // db/index.ts 顶层的连接串
	"connectionString", // new Pool({ connectionString })
	"search_turn", // schema.ts 的建表名
	"gin_trgm_ops", // schema.ts 的索引定义
	"LLM_API_KEY", // llm.ts 的密钥
];

const dir = "dist/client/assets";
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
if (files.length === 0) throw new Error(`${dir} 里没有 js，先跑 npm run build`);

const leaks = files.flatMap((file) => {
	const src = readFileSync(join(dir, file), "utf8");
	return FORBIDDEN.filter((needle) => src.includes(needle)).map(
		(needle) => `${file} 含 ${needle}`,
	);
});

if (leaks.length > 0) {
	console.error(
		`服务端代码进了客户端 bundle：\n  ${leaks.join("\n  ")}\n\n` +
			"多半是某个服务端模块的值被用在了 createServerFn 的 handler 之外。\n" +
			"把那段代码搬进服务端专属模块，页面只从 #/server/functions 取值。",
	);
	process.exit(1);
}
console.log(`客户端 bundle 干净（${files.length} 个 chunk）`);
