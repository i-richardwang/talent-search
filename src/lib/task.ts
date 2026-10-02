/** 语料任务的种类，数据库、调度与管理界面共用。 */
export const TASK_KINDS = ["sync", "derive", "review"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
