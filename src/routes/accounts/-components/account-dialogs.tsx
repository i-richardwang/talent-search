import { CircleCheckIcon } from "lucide-react";
import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { CopyButton } from "#/components/ui/copy-button";
import { Form } from "#/components/ui/form";
import { Icon } from "#/components/ui/icon";
import { Input } from "#/components/ui/input";
import { Modal } from "#/components/ui/modal";
import { toast } from "#/components/ui/toast";
import { NAME_MAX, usernameOf } from "#/lib/auth";

/** 交出去的一个密码：建账号的初始密码，或重置后的新密码。 */
export type IssuedPassword = {
	kind: "created" | "reset";
	username: string;
	password: string;
};

/** 账号页的对话框在哪一步：填新账号，或把一个密码交给管理员。 */
export type AccountDialog =
	| { step: "create" }
	| { step: "issued"; issued: IssuedPassword };

/**
 * 账号页的对话框。新建账号填完，同一个对话框翻到交出初始密码的一步；重置密码确认之后直接打开
 * 在这一步。`dialog` 为 null 时关着，关上的动画里仍画着刚才那一步。
 */
export function AccountModal({
	dialog,
	onClose,
	onCreate,
}: {
	dialog: AccountDialog | null;
	onClose: () => void;
	/** 交给服务端建账号；用户名已被占用时返回 false，对话框留在填写这一步。 */
	onCreate: (username: string, name: string) => Promise<boolean>;
}) {
	const [shown, setShown] = useState(dialog);
	if (dialog && dialog !== shown) setShown(dialog);
	const reset = shown?.step === "issued" && shown.issued.kind === "reset";
	return (
		<Modal
			className="max-w-md"
			noFooter
			onCancel={onClose}
			open={dialog !== null}
			title={reset ? "重置密码" : "新建账号"}
		>
			{shown?.step === "create" && <NewAccountForm onCreate={onCreate} />}
			{shown?.step === "issued" && (
				<Issued issued={shown.issued} onDone={onClose} />
			)}
		</Modal>
	);
}

/** 填用户名和显示名称。提交归表单自己：回车和按钮是同一件事。 */
function NewAccountForm({
	onCreate,
}: {
	onCreate: (username: string, name: string) => Promise<boolean>;
}) {
	const [busy, setBusy] = useState(false);
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
				setBusy(true);
				try {
					if (!(await onCreate(username, String(fields.name ?? "").trim())))
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
			<Button block htmlType="submit" loading={busy} type="primary">
				新建账号
			</Button>
		</Form>
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
