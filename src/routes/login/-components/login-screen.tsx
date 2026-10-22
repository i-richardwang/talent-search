import {
	EyeIcon,
	EyeOffIcon,
	LockKeyholeIcon,
	UserRoundIcon,
	UsersRoundIcon,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { AppContent, AppLayout, NavHeader } from "#/components/ui/app-layout";
import { Button } from "#/components/ui/button";
import { Form } from "#/components/ui/form";
import { Icon } from "#/components/ui/icon";
import { Input } from "#/components/ui/input";
import { ScrollArea } from "#/components/ui/scroll-area";
import { toast } from "#/components/ui/toast";

export function LoginScreen({
	onSignIn,
}: {
	onSignIn: (credentials: {
		username: string;
		password: string;
	}) => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	return (
		<AppLayout navCollapsed>
			<AppContent>
				<NavHeader
					left={
						<>
							<Icon icon={UsersRoundIcon} />
							<span className="font-medium">人才搜索</span>
						</>
					}
				/>
				<ScrollArea
					className="min-h-0 flex-1"
					contentClassName="flex min-h-full items-center justify-center p-4"
				>
					<main className="flex w-full max-w-auth flex-col gap-8" id="main">
						<div className="flex flex-col gap-4">
							<h1 className="text-auth-title font-bold">登录人才搜索</h1>
							<p className="text-auth-description font-medium text-fg-secondary">
								使用管理员分配的账号继续。
							</p>
						</div>
						<Form
							layout="vertical"
							onFormSubmit={async (fields) => {
								if (busy) return;
								setBusy(true);
								try {
									await onSignIn({
										username: String(fields.username ?? "").trim(),
										password: String(fields.password ?? ""),
									});
								} catch (error) {
									toast.error(
										error instanceof Error
											? error.message
											: "暂时无法登录，请稍后重试",
									);
								} finally {
									setBusy(false);
								}
							}}
						>
							<Form.Field label="用户名" name="username">
								<Input
									autoCapitalize="none"
									autoComplete="username"
									disabled={busy}
									maxLength={30}
									name="username"
									prefix={<Icon icon={UserRoundIcon} />}
									required
									size="large"
									spellCheck={false}
								/>
							</Form.Field>
							<Form.Field label="密码" name="password">
								<Input
									autoComplete="current-password"
									disabled={busy}
									name="password"
									prefix={<Icon icon={LockKeyholeIcon} />}
									required
									size="large"
									suffix={
										<ActionIcon
											aria-label={showPassword ? "隐藏密码" : "显示密码"}
											aria-pressed={showPassword}
											disabled={busy}
											icon={showPassword ? EyeIcon : EyeOffIcon}
											onClick={() => setShowPassword((value) => !value)}
											size="middle"
										/>
									}
									type={showPassword ? "text" : "password"}
								/>
							</Form.Field>
							<Button
								block
								htmlType="submit"
								loading={busy}
								size="large"
								type="primary"
							>
								登录
							</Button>
						</Form>
						<p className="text-center text-sm text-fg-secondary">
							没有账号或忘记密码？请联系管理员。
						</p>
					</main>
				</ScrollArea>
			</AppContent>
		</AppLayout>
	);
}
