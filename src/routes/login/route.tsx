import { createFileRoute, redirect } from "@tanstack/react-router";
import { loginDestination } from "#/lib/auth";
import { authClient } from "../-lib/auth-client";
import { LoginScreen } from "./-components/login-screen";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: loginDestination(search.redirect),
	}),
	beforeLoad: ({ context, search }) => {
		if (context.user) throw redirect({ href: search.redirect });
	},
	head: () => ({ meta: [{ title: "登录 · 人才搜索" }] }),
	component: Login,
});

function Login() {
	const { redirect: destination } = Route.useSearch();
	return (
		<LoginScreen
			onSignIn={async (credentials) => {
				const { error } = await authClient.signIn.username(credentials);
				if (error) {
					if (error.status === 429)
						throw new Error("尝试次数过多，请稍后再登录");
					if (error.status >= 500)
						throw new Error("登录服务暂时不可用，请稍后重试");
					throw new Error(
						"用户名或密码不正确，或账号已停用，请重试或联系管理员",
					);
				}
				// 整页导航丢弃上一身份的路由缓存，不在浏览器里沿用业务数据。
				window.location.replace(destination);
			}}
		/>
	);
}
