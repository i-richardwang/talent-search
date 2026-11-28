/**
 * 操作记录里记的动作。包括搜索、查看详情、导出、外部服务读取待解析经历，以及管理员对账号的操作。写下之后不改不删。
 */
export const AUDIT_ACTIONS = [
	"search",
	"derive-read",
	"resume-preview",
	"resume-download",
	"talent-add",
	"talent-link",
	"talent-remove",
	"view",
	"export",
	"create-account",
	"reset-password",
	"grant-admin",
	"revoke-admin",
	"disable-account",
	"enable-account",
	"set-scope",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
