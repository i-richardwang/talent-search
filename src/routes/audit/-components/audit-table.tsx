import { Link, useNavigate } from "@tanstack/react-router";
import { SearchXIcon, ShieldCheckIcon } from "lucide-react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Empty } from "#/components/ui/empty";
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
import type { AuditAction } from "#/lib/audit";
import { dots } from "#/lib/format";
import type { TablePage } from "#/lib/paging";
import type { AuditRow } from "#/server/audit";
import { listSearch, useSearchDraft } from "../../-components/admin-page";
import { TablePager } from "../../-components/table-pager";

const ACTION_TEXT: Record<AuditAction, string> = {
	search: "搜索",
	"derive-read": "读取待解析经历",
	view: "查看",
	export: "导出",
	"create-account": "新建账号",
	"reset-password": "重置密码",
	"grant-admin": "设为管理员",
	"revoke-admin": "取消管理员",
	"disable-account": "停用账号",
	"enable-account": "恢复账号",
	"set-scope": "改数据范围",
};

function subject(row: AuditRow): string {
	if (row.text !== null) return row.text || "无搜索条件";
	if (row.empId !== null) return dots(row.empId, row.empName);
	return dots(row.accountName, row.accountUsername);
}

/**
 * 审计页的内容：按账号、人或搜索内容找，和操作记录那张表。`pending` 是换词或翻页后新的
 * 一页还没取回，表体画同样行数的占位。
 */
export function AuditTable({
	list,
	q,
	pending = false,
}: {
	list: TablePage<AuditRow>;
	q: string;
	pending?: boolean;
}) {
	const navigate = useNavigate({ from: "/audit" });
	const [needle, setNeedle] = useSearchDraft(q);
	const search = (needle: string) =>
		void navigate({ search: listSearch(1, needle) });

	return (
		<div className="flex flex-col gap-4">
			<SearchBar
				aria-label="搜索账号、工号、姓名或搜索内容"
				className="max-w-60"
				loading={pending}
				onChange={setNeedle}
				onSearch={search}
				placeholder="搜索账号、工号、姓名或搜索内容"
				value={needle}
			/>
			<Block className="overflow-hidden" variant="outlined">
				{list.rows.length === 0 && !pending ? (
					<Empty
						action={
							q ? (
								<Button onClick={() => search("")}>清除搜索</Button>
							) : undefined
						}
						icon={q ? SearchXIcon : ShieldCheckIcon}
						size="large"
						title={q ? "没有匹配的记录" : "还没有操作记录"}
					/>
				) : (
					<Table
						busy={pending}
						footer={
							list.pages > 1 && (
								<TablePager
									linkTo={(page) => (
										<Link search={listSearch(page, q)} to="/audit" />
									)}
									table={list}
									units={{ row: "条", total: "条" }}
								/>
							)
						}
						narrow="cards"
					>
						<TableHeader>
							<TableRow>
								<TableHead>时间</TableHead>
								<TableHead>账号</TableHead>
								<TableHead>动作</TableHead>
								<TableHead className="w-full">内容</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{pending ? (
								<TableSkeletonRows
									columns={4}
									rows={Math.max(list.rows.length, 1)}
								/>
							) : (
								list.rows.map((row) => (
									<TableRow key={row.id}>
										<TableCell
											cellLabel="时间"
											className="whitespace-nowrap text-fg-secondary tabular-nums"
										>
											{row.at}
										</TableCell>
										<TableCell cellSlot="title" className="whitespace-nowrap">
											{dots(row.name, row.username)}
										</TableCell>
										<TableCell cellLabel="动作" className="whitespace-nowrap">
											{ACTION_TEXT[row.action]}
										</TableCell>
										<TableCell cellLabel="内容" className="text-fg-secondary">
											{subject(row)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				)}
			</Block>
		</div>
	);
}
