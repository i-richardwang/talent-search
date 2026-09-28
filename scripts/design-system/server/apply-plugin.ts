import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { APPLY_PATH } from "../shared/protocol";
import { applyDraft } from "../shared/tokens/css";
import { isDraft } from "../shared/tokens/draft";
import { REPO_ROOT, readTokenSources } from "./token-sources";

/*
 * 「应用到源码」：开发服务器上的一个接口，收一份修改，写回声明这些令牌的源文件。
 * 只在 `bun run ui` 的开发服务器上有；能写的只有 `TOKEN_SOURCE_PATTERNS` 列的文件，
 * 修改先过和外壳同一份校验，校验不过回 400；写的时候出错回 500，原因记在开发服务器的日志里。
 * 写完 Vite 热更新，设计系统读到的源文件值就是写进去的值。
 */

export function applyPlugin(): Plugin {
	return {
		apply: "serve",
		configureServer(server) {
			server.middlewares.use(APPLY_PATH, (request, response) => {
				if (request.method !== "POST") {
					response.statusCode = 405;
					response.end();
					return;
				}
				let body = "";
				request.setEncoding("utf8");
				request.on("data", (chunk: string) => {
					body += chunk;
				});
				request.on("end", () => {
					let draft: unknown;
					try {
						draft = JSON.parse(body);
					} catch {
						draft = undefined;
					}
					if (!isDraft(draft)) {
						response.statusCode = 400;
						response.end();
						return;
					}
					try {
						const written = applyDraft(draft, readTokenSources());
						for (const [file, css] of Object.entries(written))
							writeFileSync(join(REPO_ROOT, file), css);
						response.setHeader("content-type", "application/json");
						response.end(JSON.stringify(Object.keys(written)));
					} catch (error) {
						server.config.logger.error(String(error));
						response.statusCode = 500;
						response.end();
					}
				});
			});
		},
		name: "design-system-apply",
	};
}
