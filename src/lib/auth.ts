export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const isAdmin = (role: string | null | undefined) =>
	role?.split(",").includes("admin") ?? false;

/** 登录后只回到本站业务页面，不接受协议相对地址、反斜线或认证端点。 */
export function loginDestination(value: unknown): string {
	if (typeof value !== "string" || !value.startsWith("/")) return "/";
	try {
		const decoded = decodeURIComponent(value);
		if (
			decoded.startsWith("//") ||
			[...decoded].some((char) => char === "\\" || char < " ")
		)
			return "/";
		const url = new URL(value, "https://local.invalid");
		if (url.origin !== "https://local.invalid") return "/";
		if (/^\/(login|api)(\/|$)/.test(decodeURIComponent(url.pathname)))
			return "/";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/";
	}
}
