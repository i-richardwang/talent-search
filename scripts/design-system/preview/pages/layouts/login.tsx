import { LoginScreen } from "#/routes/login/-components/login-screen";

export function LoginPage() {
	return (
		<LoginScreen
			onSignIn={async () => {
				throw new Error("用户名或密码不正确，请重试或联系管理员");
			}}
		/>
	);
}
