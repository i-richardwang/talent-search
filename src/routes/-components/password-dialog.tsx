import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Form } from "#/components/ui/form";
import { Input } from "#/components/ui/input";
import { Modal } from "#/components/ui/modal";
import { toast } from "#/components/ui/toast";
import { PASSWORD_MAX, PASSWORD_MIN } from "#/lib/auth";
import type { PasswordRefusal } from "#/server/accounts";

const REFUSED: Record<PasswordRefusal, string> = {
	wrong: "当前密码不正确",
	length: `新密码须为 ${PASSWORD_MIN}–${PASSWORD_MAX} 个字符`,
};

/**
 * 改自己的密码。`onChange` 把当前密码和新密码交给服务端，返回没改成的原因；改成了别处的登录
 * 都会退出，这一处照常用。提交归表单自己：回车和按钮是同一件事。
 */
export function PasswordDialog({
	open,
	onClose,
	onChange,
}: {
	open: boolean;
	onClose: () => void;
	onChange: (current: string, next: string) => Promise<PasswordRefusal | null>;
}) {
	const [busy, setBusy] = useState(false);
	return (
		<Modal
			className="max-w-md"
			noFooter
			onCancel={onClose}
			open={open}
			title="修改密码"
		>
			<Form
				layout="vertical"
				onFormSubmit={async (fields) => {
					if (busy) return;
					const next = String(fields.next ?? "");
					if (next !== String(fields.again ?? ""))
						return void toast.error("两次输入的新密码不一致");
					setBusy(true);
					try {
						const refused = await onChange(String(fields.current ?? ""), next);
						if (refused) return void toast.error(REFUSED[refused]);
						onClose();
						toast.success("密码已修改，其他设备上的登录已退出");
					} catch {
						toast.error("密码没有改成，请稍后重试");
					} finally {
						setBusy(false);
					}
				}}
			>
				<Form.Field label="当前密码" name="current">
					<Input
						autoComplete="current-password"
						disabled={busy}
						name="current"
						required
						type="password"
					/>
				</Form.Field>
				<Form.Field
					desc={`${PASSWORD_MIN}–${PASSWORD_MAX} 个字符`}
					label="新密码"
					name="next"
				>
					<Input
						autoComplete="new-password"
						disabled={busy}
						maxLength={PASSWORD_MAX}
						name="next"
						required
						type="password"
					/>
				</Form.Field>
				<Form.Field label="再输入一次新密码" name="again">
					<Input
						autoComplete="new-password"
						disabled={busy}
						maxLength={PASSWORD_MAX}
						name="again"
						required
						type="password"
					/>
				</Form.Field>
				<Button block htmlType="submit" loading={busy} type="primary">
					修改密码
				</Button>
			</Form>
		</Modal>
	);
}
