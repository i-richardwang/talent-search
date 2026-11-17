/**
 * 操作记录里记的动作。前三种是对人才库做的事：发起或改了一次搜索、打开了一个人的详情、
 * 导出了一个人；其余是管理员在账号页对一个账号做的事。写下之后不改不删。
 */
export const AUDIT_ACTIONS = [
	"search",
	"view",
	"export",
	"create-account",
	"reset-password",
	"grant-admin",
	"revoke-admin",
	"disable-account",
	"enable-account",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
