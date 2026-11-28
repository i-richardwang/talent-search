import { z } from "zod";
import { EDUCATION_LADDER } from "#/corpus/contract";
import { durationMonths } from "#/lib/dates";

const label = z.string().trim().max(256);
const period = z.string().trim().max(20);
const work = z.object({
	company: label,
	title: label,
	description: z.string().trim().max(64000),
	start: period,
	end: period,
});
export const resumeSchema = z.object({
	name: label.min(1),
	school: label,
	education: z.enum(["", ...EDUCATION_LADDER]),
	contacts: z.object({ phone: label, email: label, wechat: label }),
	experiences: z.array(work).max(200),
	reviewReason: z.string().trim().max(200).optional(),
});
export type Resume = z.infer<typeof resumeSchema>;
type Contacts = Resume["contacts"];

const EMAIL = /[\w.%+-]+\s*@\s*[\w.-]+\s*\.\s*[a-z]{2,}/gi;
const PHONE =
	/(?<!\d)(?:\+?\d{1,4}[ ()-]*)?(?:\(?\d{2,4}\)?[ .-]*)?\d(?:[ -]?\d){6,13}(?!\d)/g;
const CONTACT_FIELD =
	/(?:微信(?:号)?|微讯|we\s*chat(?:\s+id)?|wx(?:id)?|vx|电子邮箱|手机号|联系电话|e-?mail|电话|联系方式)[ \t]*[:=][ \t]*[^\r\n,。;]+/gi;
const WECHAT_HANDLE =
	/(?:微信(?:号)?|微讯|we[ \t]*chat(?:[ \t]+id)?|\bwx(?:id)?\b|\bvx\b)[ \t]*(?:为|是)?[ \t]*[a-z\d][\w.-]*/gi;
function clean(text: string, contacts: Contacts) {
	let result = text
		.normalize("NFKC")
		.replace(CONTACT_FIELD, "")
		.replace(WECHAT_HANDLE, "");
	for (const raw of Object.values(contacts)) {
		const value = raw.normalize("NFKC").trim();
		if (value)
			result = result.replaceAll(
				new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
				"",
			);
	}
	return result.replace(EMAIL, "").replace(PHONE, "").trim();
}
export function sanitized(r: Resume): Resume {
	return {
		...r,
		experiences: r.experiences.map((e) => ({
			...e,
			company: clean(e.company, r.contacts),
			title: clean(e.title, r.contacts),
			description: clean(e.description, r.contacts),
		})),
	};
}

// 保留简历原始粒度。月和年用所在区间边界算时长，展示仍使用原始粒度。
function boundary(value: string, last: boolean, asOf: string) {
	const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
	if (!m) throw new Error("日期请填写年、年月或年月日");
	const year = Number(m[1]),
		month = m[2] ? Number(m[2]) : last ? 12 : 1;
	const day = m[3]
		? Number(m[3])
		: last
			? new Date(Date.UTC(year, month, 0)).getUTCDate()
			: 1;
	if (
		year < 1000 ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		new Date(Date.UTC(year, month - 1, day)).getUTCMonth() !== month - 1
	)
		throw new Error("日期不存在");
	const date = new Date(Date.UTC(year, month - 1, day))
		.toISOString()
		.slice(0, 10);
	if (date > asOf) {
		if (last && !m[3] && asOf.startsWith(value)) return asOf;
		throw new Error("经历日期不能在未来");
	}
	return date;
}
/** 草稿中缺少日期的段留待核对，已填写的日期始终按原段号校验。 */
export function periods(
	r: Resume,
	asOf: string,
	stage: "draft" | "publish" = "publish",
) {
	return r.experiences.flatMap((e, i) => {
		try {
			const startDate = e.start ? boundary(e.start, false, asOf) : null;
			const endDate =
				e.end && e.end !== "至今" ? boundary(e.end, true, asOf) : null;
			if (!startDate || !e.end) {
				if (stage === "draft") return [];
				throw new Error("请核对缺少的起止日期，仍在职请填「至今」");
			}
			const stop = endDate ?? asOf;
			if (stop < startDate) throw new Error("结束日期早于开始日期");
			return [
				{
					...e,
					startDate,
					endDate,
					months: durationMonths(new Date(startDate), new Date(stop)),
				},
			];
		} catch (error) {
			throw new Error(`第 ${i + 1} 段：${(error as Error).message}`);
		}
	});
}
