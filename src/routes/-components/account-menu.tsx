import { KeyRoundIcon, LogOutIcon } from "lucide-react";
import { useState } from "react";
import { AppNavIdentity } from "#/components/ui/app-layout";
import { Avatar } from "#/components/ui/avatar";
import {
	DropdownMenuHeader,
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { toast } from "#/components/ui/toast";
import { dots } from "#/lib/format";
import { changePassword } from "#/server/auth-functions";
import { authClient } from "../-lib/auth-client";
import { PasswordDialog } from "./password-dialog";

/**
 * 导航栏顶上的当前账号。点开是账号菜单：上面是头像、名字、用户名和角色，下面是修改密码和
 * 退出登录。退出成功后整页换到登录页，没退成给一句提示。
 */
export function AccountMenu({
	user,
}: {
	user: { name: string; username: string; admin: boolean };
}) {
	const [changing, setChanging] = useState(false);
	const signOut = async () => {
		try {
			const { error } = await authClient.signOut();
			if (error) throw error;
			window.location.replace("/login");
		} catch {
			toast.error("退出登录没有成功，请重试");
		}
	};
	return (
		<>
			<DropdownMenuRoot>
				<DropdownMenuTrigger>
					<AppNavIdentity
						avatar={<Avatar seed={user.username} size={28} />}
						name={user.name}
					/>
				</DropdownMenuTrigger>
				<DropdownMenuPortal>
					<DropdownMenuPositioner>
						<DropdownMenuPopup className="min-w-75">
							<DropdownMenuHeader className="flex items-center gap-2.5">
								<Avatar seed={user.username} size={36} />
								<div className="min-w-0">
									<p className="truncate font-semibold">{user.name}</p>
									<p className="truncate text-fg-secondary text-xs">
										{dots(user.username, user.admin ? "管理员" : null)}
									</p>
								</div>
							</DropdownMenuHeader>
							{renderDropdownMenuItems([
								{
									icon: KeyRoundIcon,
									key: "password",
									label: "修改密码",
									onClick: () => setChanging(true),
								},
								{ type: "divider" },
								{
									icon: LogOutIcon,
									key: "sign-out",
									label: "退出登录",
									onClick: () => void signOut(),
								},
							])}
						</DropdownMenuPopup>
					</DropdownMenuPositioner>
				</DropdownMenuPortal>
			</DropdownMenuRoot>
			<PasswordDialog
				onChange={(current, next) =>
					changePassword({ data: { current, next } })
				}
				onClose={() => setChanging(false)}
				open={changing}
			/>
		</>
	);
}
