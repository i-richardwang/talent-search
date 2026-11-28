import { CircleCheckIcon } from "lucide-react";
import { useState } from "react";
import { OrgPicker } from "#/components/org-picker";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { CopyButton } from "#/components/ui/copy-button";
import { Form } from "#/components/ui/form";
import { Icon } from "#/components/ui/icon";
import { Input } from "#/components/ui/input";
import { Modal } from "#/components/ui/modal";
import { Radio, RadioGroup } from "#/components/ui/radio";
import { toast } from "#/components/ui/toast";
import { NAME_MAX, usernameOf } from "#/lib/auth";
import type { OrgNode } from "#/lib/org";

/** 交出去的一个密码：建账号的初始密码，或重置后的新密码。 */
type IssuedPassword = {
	kind: "created" | "reset";
	username: string;
	password: string;
};

/** 交给服务端建账号；用户名已被占用时返回 false，对话框留在填写这一步。 */
type SubmitAccount = (
	username: string,
	name: string,
	admin: boolean,
	orgs: string[],
) => Promise<boolean>;

/** 交给服务端换掉一个账号的数据范围。 */
type SubmitScope = (username: string, orgs: string[]) => Promise<void>;

/** 账号页的对话框在哪一步：填新账号、改一个账号的数据范围，或把一个密码交给管理员。 */
export type AccountDialog =
	| { step: "create" }
	| { step: "scope"; username: string; orgs: string[] }
	| { step: "issued"; issued: IssuedPassword };

const TITLES = {
	create: "新建账号",
	scope: "数据范围",
	created: "新建账号",
	reset: "重置密码",
} as const;

/**
 * 账号页的对话框。新建账号填完，同一个对话框翻到交出初始密码的一步；重置密码确认之后直接打开
 * 在这一步。选数据范围的两步用打开时取的组织树，`tree` 为 null 时还在取。`dialog` 为 null 时
 * 关着，关上的动画里仍画着刚才那一步。
 */
export function AccountModal({
	dialog,
	tree,
	onClose,
	onCreate,
	onScope,
}: {
	dialog: AccountDialog | null;
	tree: OrgNode[] | null;
	onClose: () => void;
	onCreate: SubmitAccount;
	onScope: SubmitScope;
}) {
	const [shown, setShown] = useState(dialog);
	if (dialog && dialog !== shown) setShown(dialog);
	const title =
		shown?.step === "issued"
			? TITLES[shown.issued.kind]
			: TITLES[shown?.step ?? "create"];
	return (
		<Modal
			className="max-w-md"
			noFooter
			onCancel={onClose}
			open={dialog !== null}
			title={title}
		>
			{shown?.step === "create" && (
				<NewAccountForm onCreate={onCreate} tree={tree} />
			)}
			{shown?.step === "scope" && (
				<ScopeForm
					initial={shown.orgs}
					onDone={onClose}
					onScope={(orgs) => onScope(shown.username, orgs)}
					tree={tree}
					username={shown.username}
				/>
			)}
			{shown?.step === "issued" && (
				<Issued issued={shown.issued} onDone={onClose} />
			)}
		</Modal>
	);
}

const SCOPE_DESC = "这个账号能搜到、能看到的人：此刻在这些组织里的员工";

/**
 * 填用户名、显示名称，选角色（默认普通用户）和数据范围。提交归表单自己：回车和按钮是同一件事。
 */
function NewAccountForm({
	onCreate,
	tree,
}: {
	onCreate: SubmitAccount;
	tree: OrgNode[] | null;
}) {
	const [busy, setBusy] = useState(false);
	const [orgs, setOrgs] = useState<string[]>([]);
	return (
		<Form
			layout="vertical"
			onFormSubmit={async (fields) => {
				if (busy) return;
				const username = usernameOf(String(fields.username ?? ""));
				if (!username)
					return void toast.error(
						"用户名须为 3–30 个英文字母、数字、下划线或点",
					);
				if (orgs.length === 0)
					return void toast.error("选好这个账号的数据范围再建");
				setBusy(true);
				try {
					const name = String(fields.name ?? "").trim();
					if (!(await onCreate(username, name, fields.role === "admin", orgs)))
						toast.error(`用户名 ${username} 已被占用，换一个再建`);
				} catch {
					toast.error("账号没有建成，请稍后重试");
				} finally {
					setBusy(false);
				}
			}}
		>
			<Form.Field
				desc="登录时用，3–30 个英文字母、数字、下划线或点，不分大小写"
				label="用户名"
				name="username"
			>
				<Input
					autoComplete="off"
					disabled={busy}
					maxLength={30}
					name="username"
					required
				/>
			</Form.Field>
			<Form.Field desc="不填就用用户名" label="显示名称" name="name">
				<Input
					autoComplete="off"
					disabled={busy}
					maxLength={NAME_MAX}
					name="name"
				/>
			</Form.Field>
			<Form.Field
				desc="管理员能看任务和审计，能管理除自己以外的全部账号"
				label="角色"
				name="role"
			>
				<RadioGroup className="flex gap-6" defaultValue="user" name="role">
					<Radio value="user">普通用户</Radio>
					<Radio value="admin">管理员</Radio>
				</RadioGroup>
			</Form.Field>
			<Form.Field desc={SCOPE_DESC} label="数据范围">
				<OrgPicker
					disabled={busy}
					onChange={setOrgs}
					tree={tree}
					value={orgs}
				/>
			</Form.Field>
			<Button block htmlType="submit" loading={busy} type="primary">
				新建账号
			</Button>
		</Form>
	);
}

/** 改一个账号的数据范围，从它现在的范围开始改。存成了关上对话框。 */
function ScopeForm({
	username,
	initial,
	tree,
	onScope,
	onDone,
}: {
	username: string;
	initial: string[];
	tree: OrgNode[] | null;
	onScope: (orgs: string[]) => Promise<void>;
	onDone: () => void;
}) {
	const [orgs, setOrgs] = useState(initial);
	return (
		<div className="flex flex-col gap-4">
			<p className="text-fg-secondary text-sm">
				{username} {SCOPE_DESC}。改完对方下一次搜索、打开详情就按新的范围。
			</p>
			<OrgPicker onChange={setOrgs} tree={tree} value={orgs} />
			<Button
				block
				disabled={orgs.length === 0}
				onClick={async () => {
					try {
						await onScope(orgs);
						onDone();
					} catch {
						toast.error("数据范围没有改成，请稍后重试");
					}
				}}
				type="primary"
			>
				保存
			</Button>
		</div>
	);
}

/**
 * 把服务端生成的密码给管理员看一次。关上就再也取不回：服务端只存哈希，要再给就重置。
 */
function Issued({
	issued,
	onDone,
}: {
	issued: IssuedPassword;
	onDone: () => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			<p className="flex items-center gap-2 font-medium">
				<Icon className="text-success" icon={CircleCheckIcon} size={18} />
				{issued.kind === "reset"
					? `已重置 ${issued.username} 的密码`
					: `已建好 ${issued.username} 的账号`}
			</p>
			<Block
				align="center"
				className="px-3 py-2.5"
				gap={8}
				horizontal
				variant="outlined"
			>
				<code className="min-w-0 flex-1 break-all font-mono text-xs">
					{issued.password}
				</code>
				<CopyButton content={issued.password} size="small" title="复制密码" />
			</Block>
			<p className="text-fg-secondary text-xs">
				{issued.kind === "reset" ? "原来的登录都已退出。" : ""}
				密码只显示这一次，关上之后取不回来，请现在复制交给对方。对方登录后点导航栏左上角自己的名字，可以改成自己的密码。
			</p>
			<Button block onClick={onDone} type="primary">
				完成
			</Button>
		</div>
	);
}
