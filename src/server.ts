/**
 * 服务端入口。TanStack Start 认这个文件（`src/server.ts`）：所有请求从这里进。
 *
 * 自定义它只为一件事：进程起来的时候把后台任务的排班启动起来（`server/jobs.ts`）。
 * 派生和整理是这个应用自己持续在做的工作，不该等谁打开哪一页才开始。
 */

import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { startJobs } from "#/server/jobs";

// 不等它：排班起不来（库不通）会在标准错误里说，请求照常服务
void startJobs().catch((error) => console.error("后台任务没能启动：", error));

export default createServerEntry({
	fetch: createStartHandler(defaultStreamHandler),
});
