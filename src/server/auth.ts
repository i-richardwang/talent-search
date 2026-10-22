import "@tanstack/react-start/server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin, username } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db";
import {
	authAccount,
	authSession,
	authUser,
	authVerification,
} from "#/db/schema";
import { PASSWORD_MAX, PASSWORD_MIN } from "#/lib/auth";

function createAuth() {
	const secret = process.env.BETTER_AUTH_SECRET;
	const baseURL = process.env.BETTER_AUTH_URL;
	if (!secret || secret.length < 32)
		throw new Error("BETTER_AUTH_SECRET 必须配置且至少 32 个字符");
	if (!baseURL) throw new Error("BETTER_AUTH_URL 未配置");
	const url = new URL(baseURL);
	if (
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		url.username ||
		url.password
	)
		throw new Error("BETTER_AUTH_URL 必须是应用的完整来源地址，不含路径");
	if (
		url.protocol !== "https:" &&
		!(url.protocol === "http:" && process.env.NODE_ENV !== "production")
	)
		throw new Error("生产环境的 BETTER_AUTH_URL 必须使用 HTTPS");
	return betterAuth({
		appName: "人才搜索",
		baseURL: url.origin,
		secret,
		advanced: { disableOriginCheck: false, disableCSRFCheck: false },
		database: drizzleAdapter(db, {
			provider: "pg",
			transaction: true,
			schema: {
				user: authUser,
				session: authSession,
				account: authAccount,
				verification: authVerification,
			},
		}),
		emailAndPassword: {
			enabled: true,
			disableSignUp: true,
			minPasswordLength: PASSWORD_MIN,
			maxPasswordLength: PASSWORD_MAX,
		},
		// 每次从数据库读取身份，撤销会话、修改角色在下一次请求就生效。
		session: { cookieCache: { enabled: false } },
		rateLimit: { enabled: true },
		plugins: [
			admin(),
			username({ displayUsername: false, immutableUsername: true }),
			tanstackStartCookies(),
		],
	});
}

let instance: ReturnType<typeof createAuth> | undefined;

/** 构建、同步与解析不需要认证密钥；只有认证请求和账号管理才初始化。 */
export const getAuth = () => (instance ??= createAuth());

/** 浏览器只开放登录、退出和会话；账号管理仅能从受信任的本机命令行调用。 */
export function handleAuth(request: Request): Promise<Response> | Response {
	const path = new URL(request.url).pathname.slice("/api/auth".length);
	const allowed =
		request.method === "GET"
			? path === "/get-session"
			: request.method === "POST" &&
				["/sign-in/username", "/sign-out"].includes(path);
	if (!allowed) return new Response(null, { status: 404 });
	return getAuth().handler(request);
}
