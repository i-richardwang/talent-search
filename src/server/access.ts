import "@tanstack/react-start/server-only";
import { isAdmin } from "#/lib/auth";
import { getAuth } from "./auth";

export async function viewer(headers: Headers) {
	const session = await getAuth().api.getSession({ headers });
	if (!session) return null;
	const { user } = session;
	// 库里用户名非空（只能用用户名登录）；Better Auth 的类型按插件把它声明成可选，这里收窄
	if (!user.username) return null;
	if (user.banned && (!user.banExpires || user.banExpires > new Date()))
		return null;
	return {
		id: user.id,
		name: user.name,
		username: user.username,
		admin: isAdmin(user.role),
	};
}

export async function requireViewer(headers: Headers, admin = false) {
	const user = await viewer(headers);
	if (!user) throw new Response("请先登录", { status: 401 });
	if (admin && !user.admin)
		throw new Response("仅管理员可以操作", { status: 403 });
	return user;
}
