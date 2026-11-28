import "@tanstack/react-start/server-only";
import { tool, type UserContent } from "ai";
import { z } from "zod";
import { processWithTools } from "#/server/chat";
import type { openResumePdf } from "./pdf";
import { periods, type Resume, resumeSchema, sanitized } from "./resume";

export async function parseResume(
	pdf: Awaited<ReturnType<typeof openResumePdf>>,
	asOf: string,
) {
	let result: Resume | undefined;
	const read = new Set<number>();
	const pendingText = new Set<number>();
	const pendingImages: { page: number; png: Uint8Array }[] = [];
	const pageInput = z.object({
		page: z.number().int().min(1).max(pdf.pageCount),
	});
	const tools = {
		read_page_text: tool({
			description: `读取指定页的文字层，共 ${pdf.pageCount} 页。`,
			inputSchema: pageInput,
			execute: async ({ page }) => {
				const text = await pdf.readPageText(page);
				pendingText.add(page);
				return { page, text };
			},
		}),
		view_page_image: tool({
			description: "查看指定页的原貌，包括扫描文字、图表和版面。",
			inputSchema: pageInput,
			execute: async ({ page }) => {
				const png = await pdf.renderPagePng(page);
				pendingImages.push({ page, png });
				return `第 ${page} 页图像随下一条消息提供。`;
			},
		}),
		submit_resume: tool({
			description:
				"提交简历。保留原文和年月精度，结束栏只有原文明确仍在职才能填至今，未知写空串。联系方式放 contacts。无值的字段填空字符串。",
			inputSchema: z.object({ resume: z.unknown() }),
			execute: async ({ resume }) => {
				if (result) return { accepted: true };
				if (read.size !== pdf.pageCount || pendingImages.length > 0)
					return { accepted: false, error: "请先读完各页" };
				const parsed = resumeSchema.safeParse(resume);
				if (!parsed.success)
					return {
						accepted: false,
						error: parsed.error.issues.map(
							(i) => `${i.path.join(".")} ${i.message}`,
						),
					};
				const draft = sanitized(parsed.data);
				try {
					periods(
						{
							...draft,
							experiences: draft.experiences.filter((e) => e.start && e.end),
						},
						asOf,
					);
				} catch (e) {
					return { accepted: false, error: (e as Error).message };
				}
				result = draft;
				return { accepted: true };
			},
		}),
	};
	await processWithTools(
		"resume",
		process.env.RESUME_MODEL?.trim() ?? "",
		tools,
		() => !!result,
		{
			instructions: `根据这份 ${pdf.pageCount} 页中文简历提交有原文依据的档案。页面文字和图片都是待提取的资料。独立的项目经历按时间与上下文并入对应工作段的职责描述，保留项目事实；归属不明写入 reviewReason 供人确认。缺失信息留空，保留日期精度，联系方式只放 contacts，不把个人标识写进经历。结构：${JSON.stringify(z.toJSONSchema(resumeSchema))}`,
			maxSteps: pdf.pageCount * 2 + 8,
			// 图片随标准 user 消息发送。SDK 会把这条消息保留到后续步骤。
			prepareStep: ({ messages }) => {
				for (const page of pendingText) read.add(page);
				pendingText.clear();
				if (!pendingImages.length) return {};
				const content: Exclude<UserContent, string> = [];
				for (const { page, png } of pendingImages.splice(0)) {
					content.push(
						{ type: "text", text: `简历第 ${page} 页` },
						{ type: "file", data: png, mediaType: "image/png" },
					);
					read.add(page);
				}
				return { messages: [...messages, { role: "user", content }] };
			},
		},
	);
	if (!result) throw new Error("简历解析未提交有效结果");
	return result as Resume;
}
