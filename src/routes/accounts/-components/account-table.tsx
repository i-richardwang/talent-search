import { Link, useNavigate } from "@tanstack/react-router";
import {
	EllipsisIcon,
	KeyRoundIcon,
	PlusIcon,
	SearchXIcon,
	ShieldMinusIcon,
	ShieldPlusIcon,
	UserCheckIcon,
	UserXIcon,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import {
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { Empty } from "#/components/ui/empty";
import { confirmModal } from "#/components/ui/modal";
import { SearchBar } from "#/components/ui/search-bar";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	TableSkeletonRows,
} from "#/components/ui/table";
import { Tag } from "#/components/ui/tag";
import { toast } from "#/components/ui/toast";
import { dots } from "#/lib/format";
import type { TablePage } from "#/lib/paging";
import type { AccountRow } from "#/server/accounts";
import { listSearch, useSearchDraft } from "../../-components/admin-page";
import { TablePager } from "../../-components/table-pager";
import { type AccountDialog, AccountModal } from "./account-dialogs";

/**
 * 账号页能做的事，各自交给服务端，改成了之后由调用处重取这张表。`create` 在用户名已被占用时
 * 返回 null，建成了返回初始密码；`reset` 返回新密码。
 */
export type AccountActions = {
	create: (
		username: string,
		name: string,
		admin: boolean,
	) => Promise<string | null>;
	reset: (username: string) => Promise<string>;
	setAdmin: (username: string, admin: boolean) => Promise<void>;
	setDisabled: (username: string, disabled: boolean) => Promise<void>;
};

/**
 * 账号页的内容：按用户名或显示名称找、新建账号，和全部账号那张表。停用了的账号名字后面
 * 跟一个「已停用」。别人的账号行尾有菜单：重置密码、设为或取消管理员、停用（或恢复）；
 * 自己那一行（`self` 是当前账号的用户名）标着「当前账号」，没有菜单，自己的密码在导航栏的
 * 账号菜单里改。`pending` 是换词或翻页后新的一页还没取回，表体画同样行数的占位。
 */
export function AccountTable({
	list,
	q,
	self,
	actions,
	pending = false,
}: {
	list: TablePage<AccountRow>;
	q: string;
	self: string;
	actions: AccountActions;
	pending?: boolean;
}) {
	const navigate = useNavigate({ from: "/accounts" });
	const [needle, setNeedle] = useSearchDraft(q);
	const search = (needle: string) =>
		void navigate({ search: listSearch(1, needle) });
	const [dialog, setDialog] = useState<AccountDialog | null>(null);

	const reset = (account: AccountRow) =>
		confirmModal({
			content:
				"重置后对方所有设备上的登录都会退出，原来的密码不能再用。系统会生成一个新密码，只显示一次。",
			okText: "重置",
			onOk: async () => {
				try {
					const password = await actions.reset(account.username);
					setDialog({
						issued: { kind: "reset", password, username: account.username },
						step: "issued",
					});
				} catch (error) {
					toast.error("密码没有重置成功，请稍后重试");
					throw error;
				}
			},
			title: `重置「${account.username}」的密码？`,
		});

	const disable = (account: AccountRow) =>
		confirmModal({
			content:
				"停用后对方所有设备上的登录都会退出，之后不能再登录。搜索记录和操作记录都保留，需要时可以随时恢复。",
			okText: "停用",
			onOk: async () => {
				try {
					await actions.setDisabled(account.username, true);
					toast.success(`账号「${account.username}」已停用`);
				} catch (error) {
					toast.error("账号没有停用成功，请稍后重试");
					throw error;
				}
			},
			title: `停用「${account.username}」？`,
		});

	// 恢复收得回，不先问；行上的「已停用」去掉就是结果，不另出提示
	const enable = async (account: AccountRow) => {
		try {
			await actions.setDisabled(account.username, false);
		} catch {
			toast.error("账号没有恢复成功，请稍后重试");
		}
	};

	const grant = (account: AccountRow) =>
		confirmModal({
			content:
				"管理员能看任务和审计，能管理除自己以外的全部账号，包括别的管理员。之后可以随时取消。",
			okText: "设为管理员",
			onOk: async () => {
				try {
					await actions.setAdmin(account.username, true);
				} catch (error) {
					toast.error("没有设成管理员，请稍后重试");
					throw error;
				}
			},
			title: `把「${account.username}」设为管理员？`,
		});

	// 取消管理员收得回，不先问；角色那一格变了就是结果
	const revoke = async (account: AccountRow) => {
		try {
			await actions.setAdmin(account.username, false);
		} catch {
			toast.error("没有取消管理员，请稍后重试");
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<SearchBar
					aria-label="搜索用户名或显示名称"
					className="max-w-60"
					loading={pending}
					onChange={setNeedle}
					onSearch={search}
					placeholder="搜索用户名或显示名称"
					value={needle}
				/>
				<Button
					icon={PlusIcon}
					onClick={() => setDialog({ step: "create" })}
					type="primary"
				>
					新建账号
				</Button>
			</div>
			<Block className="overflow-hidden" variant="outlined">
				{list.rows.length === 0 && !pending ? (
					// 至少有正在看这一页的管理员自己，表空只会是搜不到
					<Empty
						action={<Button onClick={() => search("")}>清除搜索</Button>}
						icon={SearchXIcon}
						size="large"
						title="没有匹配的账号"
					/>
				) : (
					<Table
						busy={pending}
						footer={
							list.pages > 1 && (
								<TablePager
									linkTo={(page) => (
										<Link search={listSearch(page, q)} to="/accounts" />
									)}
									table={list}
									units={{ row: "个", total: "个" }}
								/>
							)
						}
						narrow="cards"
					>
						<TableHeader>
							<TableRow>
								<TableHead className="w-full">账号</TableHead>
								<TableHead>角色</TableHead>
								<TableHead>
									<span className="sr-only">操作</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{pending ? (
								<TableSkeletonRows
									columns={3}
									rows={Math.max(list.rows.length, 1)}
								/>
							) : (
								list.rows.map((account) => (
									<TableRow key={account.username}>
										<TableCell cellSlot="title">
											<span className="flex items-center gap-2">
												{dots(account.name, account.username)}
												{account.username === self && (
													<Tag size="small">当前账号</Tag>
												)}
												{account.disabled && <Tag size="small">已停用</Tag>}
											</span>
										</TableCell>
										<TableCell cellLabel="角色" className="whitespace-nowrap">
											{account.admin ? "管理员" : "普通用户"}
										</TableCell>
										<TableCell cellSlot="extra">
											{account.username !== self && (
												<AccountRowMenu
													account={account}
													onDisable={() => disable(account)}
													onEnable={() => void enable(account)}
													onGrant={() => grant(account)}
													onReset={() => reset(account)}
													onRevoke={() => void revoke(account)}
												/>
											)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				)}
			</Block>
			<AccountModal
				dialog={dialog}
				onClose={() => setDialog(null)}
				onCreate={async (username, name, admin) => {
					const password = await actions.create(username, name, admin);
					if (password === null) return false;
					setDialog({
						issued: { kind: "created", password, username },
						step: "issued",
					});
					return true;
				}}
			/>
		</div>
	);
}

/**
 * 别人的账号行尾的菜单：重置密码，设为或取消管理员，停用或恢复。停用了的账号只有恢复，
 * 别的事恢复之后再做。
 */
function AccountRowMenu({
	account,
	onReset,
	onGrant,
	onRevoke,
	onDisable,
	onEnable,
}: {
	account: AccountRow;
	onReset: () => void;
	onGrant: () => void;
	onRevoke: () => void;
	onDisable: () => void;
	onEnable: () => void;
}) {
	const items = account.disabled
		? [{ icon: UserCheckIcon, key: "enable", label: "恢复", onClick: onEnable }]
		: [
				{
					icon: KeyRoundIcon,
					key: "reset",
					label: "重置密码",
					onClick: onReset,
				},
				account.admin
					? {
							icon: ShieldMinusIcon,
							key: "revoke",
							label: "取消管理员",
							onClick: onRevoke,
						}
					: {
							icon: ShieldPlusIcon,
							key: "grant",
							label: "设为管理员",
							onClick: onGrant,
						},
				{
					danger: true,
					icon: UserXIcon,
					key: "disable",
					label: "停用",
					onClick: onDisable,
				},
			];
	return (
		<DropdownMenuRoot>
			<DropdownMenuTrigger>
				<ActionIcon
					icon={EllipsisIcon}
					size="small"
					title={`管理 ${account.username}`}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuPositioner align="end">
					<DropdownMenuPopup>
						{renderDropdownMenuItems(items)}
					</DropdownMenuPopup>
				</DropdownMenuPositioner>
			</DropdownMenuPortal>
		</DropdownMenuRoot>
	);
}
