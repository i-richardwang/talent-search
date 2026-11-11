/**
 * 数据目录：查询理解的模型能读的数据，每个关系、每一列的中文名、含义和口径。
 *
 * 关系就是 `db/schema.ts` 里 `catalog` schema 的视图，加上每次检索由外壳物化的命中表
 * `hit`。这里的声明有三个读者：查询理解的系统提示词（静态的一份目录）、SQL 白名单
 * （`server/sandbox.ts` 按它核对引用的关系和列）、`discover` 工具（活的统计）。
 * 视图的列名由类型和 schema 绑定：视图多一列、这里少写一列，类型检查不过。
 *
 * 目录文本是提示词的一部分，所以它也是一份「标准」：目录变了，查询理解的验收要重跑。
 */
import type { PgViewWithSelection } from "drizzle-orm/pg-core";
import type {
	catalogExperience,
	catalogPerson,
	catalogRating,
	catalogScale,
	catalogStatus,
} from "#/db/schema";

type ColumnsOf<V> =
	V extends PgViewWithSelection<string, boolean, infer F>
		? keyof F & string
		: never;

/**
 * 一列的声明。有限取值的列 `discover` 给出取值和人数：enum 只筛；ordinal 还能比高低，
 * `rank` 是同一关系里它的档高列，列取值时按它从低到高排。
 */
type CatalogColumn<C extends string = string> = {
	type: "text" | "int" | "date" | "text[]";
	label: string;
	meaning: string;
} & ({ values?: "enum" } | { values: "ordinal"; rank: C });

export type CatalogRelation<C extends string = string> = {
	/** 关系名，也是 SQL 里写的名字 */
	name: string;
	label: string;
	/** 一行是什么 */
	rows: string;
	columns: Record<C, CatalogColumn<C>>;
	/** 口径：缺失算什么、怎么去重、能不能跨期比 */
	notes: string[];
};

const person: CatalogRelation<ColumnsOf<typeof catalogPerson>> = {
	name: "person",
	label: "员工",
	rows: "一个员工",
	columns: {
		emp_id: {
			type: "text",
			label: "工号",
			meaning: "只作关联键：rating.emp_id = p.emp_id",
		},
		level_band: {
			type: "text",
			label: "职级档",
			meaning: "当前职级归入的档",
			values: "ordinal",
			rank: "level_rank",
		},
		level_rank: {
			type: "int",
			label: "职级档高",
			meaning: "越大越高；「某档及以上」比它",
		},
		education: {
			type: "text",
			label: "学历",
			meaning: "最高学历：高中及以下、大专、本科、硕士、博士",
			values: "ordinal",
			rank: "education_rank",
		},
		education_rank: {
			type: "int",
			label: "学历档高",
			meaning: "越大越高",
		},
		school: {
			type: "text",
			label: "学校",
			meaning: "最高学历那所学校的名字",
		},
		school_tier: {
			type: "text",
			label: "学校档",
			meaning:
				"最高学历那所学校的档（985、211、QS100 这类），档与档之间不比高低",
			values: "enum",
		},
		overseas: {
			type: "text",
			label: "海外学历",
			meaning: "最高学历是不是海外取得：是、否；为空表示没有记录",
			values: "enum",
		},
		recruitment: {
			type: "text",
			label: "招聘渠道",
			meaning: "校招、社招这类",
			values: "enum",
		},
		hire_date: { type: "date", label: "入职日", meaning: "入职公司的日期" },
		cur_dept: {
			type: "text",
			label: "当前部门",
			meaning: "当前任职的末级部门",
		},
		cur_seq_l1: {
			type: "text",
			label: "当前一级序列",
			meaning: "技术、运营这类",
		},
		cur_seq_l2: {
			type: "text",
			label: "当前二级序列",
			meaning: "后端开发这类",
		},
		cur_seq_l3: { type: "text", label: "当前三级序列", meaning: "更细的序列" },
	},
	notes: ["空值表示没有记录，不表示任何一档。"],
};

const experience: CatalogRelation<ColumnsOf<typeof catalogExperience>> = {
	name: "experience",
	label: "工作经历",
	rows: "一段工作经历（公司内的一段任职，或入职前的一段经历）",
	columns: {
		id: { type: "int", label: "段", meaning: "这一段的身份" },
		emp_id: { type: "text", label: "工号", meaning: "只作关联键" },
		kind: {
			type: "text",
			label: "来源",
			meaning: "internal 是公司内的任职，external 是入职前的经历",
			values: "enum",
		},
		start_date: { type: "date", label: "开始", meaning: "这一段的开始日" },
		end_date: {
			type: "date",
			label: "结束",
			meaning: "这一段的结束日；为空表示至今",
		},
		months: { type: "int", label: "月数", meaning: "这一段有多少个月" },
		company: {
			type: "text",
			label: "公司",
			meaning: "入职前那家公司的名字；公司内的任职为空",
		},
		company_tag: {
			type: "text",
			label: "公司档",
			meaning: "人事登记的入职前那家公司的档；公司内的任职为空",
			values: "enum",
		},
		company_nature: {
			type: "text",
			label: "企业性质",
			meaning: "人事登记的入职前那家公司的性质：民企、外企、国企这类",
			values: "enum",
		},
		company_name: {
			type: "text",
			label: "公司规范名",
			meaning: "company 的各种写法对到的那家公司；没认出是哪家公司时为空",
		},
		company_group: {
			type: "text",
			label: "集团",
			meaning: "那家公司所属的集团，没有上级的就是它自己",
		},
		main_industries: {
			type: "text[]",
			label: "主营行业",
			meaning: "那家公司的主营行业，连同每一级上级行业",
			values: "enum",
		},
		industries: {
			type: "text[]",
			label: "涉足行业",
			meaning: "那家公司做的全部行业（主营在内），连同每一级上级行业",
			values: "enum",
		},
		company_circles: {
			type: "text[]",
			label: "名企组合",
			meaning: "那家公司属于的约定俗成的组合，例如四大、MBB",
			values: "enum",
		},
		department: {
			type: "text",
			label: "部门",
			meaning: "公司内任职的末级部门；入职前的经历为空",
		},
		department_path: {
			type: "text",
			label: "部门路径",
			meaning: "公司内任职的完整部门路径；入职前的经历为空",
		},
		title: { type: "text", label: "岗位", meaning: "岗位名" },
		level: {
			type: "text",
			label: "职级原文",
			meaning: "这一段登记的职级原文，只在公司内的任职上有",
		},
		seq_l1: {
			type: "text",
			label: "一级序列",
			meaning: "登记的序列；入职前的经历是按岗位名对齐的序列",
		},
		seq_l2: { type: "text", label: "二级序列", meaning: "和一级序列成对" },
		skills: {
			type: "text[]",
			label: "能力词",
			meaning: "从入职前简历读出的能力词的标准写法，连同它们更宽的词",
		},
	},
	notes: [
		"待业不是一段工作经历，不在这里。",
		"公司和公司的各项属性只在入职前的经历上，部门只在公司内的任职上，一段只有其一。",
		"行业、集团、名企组合说的是那家公司，不是这个人做的事：在外卖公司待过不等于做过外卖业务，做过什么仍写进 seek。",
		"行业是一棵树，取值连同上级都在数组里：:v = any(e.main_industries) 写上级行业就包含它下面的每一个细分。",
		"公司没认出来、或认出来了但没有行业时，行业两列为空，不满足任何行业条件；「不是某行业」同样不成立。",
		"做过什么不按岗位名或部门名的字面筛：写进 seek，命中在 hit 上。",
	],
};

const rating: CatalogRelation<ColumnsOf<typeof catalogRating>> = {
	name: "rating",
	label: "评级",
	rows: "一个人在一条评级流里的一期评级（例如一期绩效）",
	columns: {
		emp_id: { type: "text", label: "工号", meaning: "只作关联键" },
		stream: {
			type: "text",
			label: "记录流",
			meaning: "哪一条评级流，例如绩效；有哪些流用 discover 查",
			values: "enum",
		},
		period_start: { type: "date", label: "期始", meaning: "这一期的开始日" },
		period_end: { type: "date", label: "期末", meaning: "这一期的结束日" },
		value: {
			type: "text",
			label: "档",
			meaning: "这一期评的档",
			values: "ordinal",
			rank: "value_rank",
		},
		value_rank: {
			type: "int",
			label: "档高",
			meaning: "这一档在 scale 里的高低，越大越高",
		},
	},
	notes: [
		"同一人同一流同一期只有一行，修订只留最终一条。",
		"没有某一期的行表示那一期没有记录，不算任何一档，也不算低或高。",
		"没有任何记录的人不满足关于这条流的任何条件，包括「从没拿过 C」这样的否定：写否定时同时要求有记录。",
		"「近三年」按日期算：period_end >= current_date - interval '3 years'，不按期数换算。",
		"比高低只比 value_rank，档高从 scale 查，不比档名字面。",
	],
};

const status: CatalogRelation<ColumnsOf<typeof catalogStatus>> = {
	name: "status",
	label: "状态",
	rows: "一个人在一条状态流里的一段（例如在高潜池里的一段时间）",
	columns: {
		emp_id: { type: "text", label: "工号", meaning: "只作关联键" },
		stream: {
			type: "text",
			label: "记录流",
			meaning: "哪一条状态流，例如高潜池；有哪些流用 discover 查",
			values: "enum",
		},
		value: {
			type: "text",
			label: "状态",
			meaning: "这一段处于什么状态",
			values: "enum",
		},
		valid_from: { type: "date", label: "起", meaning: "这一段的开始日" },
		valid_to: {
			type: "date",
			label: "止",
			meaning: "这一段的结束日；为空表示仍有效",
		},
	},
	notes: [
		"「现在在」是 valid_to is null or valid_to >= current_date。",
		"没有行表示没有记录。",
	],
};

const scale: CatalogRelation<ColumnsOf<typeof catalogScale>> = {
	name: "scale",
	label: "档位表",
	rows: "一个档：职级档（stream = 'level'）、学历档（'education'）和各评级流的档",
	columns: {
		stream: { type: "text", label: "流", meaning: "哪一套档" },
		value: { type: "text", label: "档名", meaning: "档的名字" },
		rank: { type: "int", label: "档高", meaning: "越大越高" },
	},
	notes: [
		"「A 及以上」写成 r.value_rank >= (select s.rank from scale s where s.stream = r.stream and s.value = 'A')。",
		"职级和学历的「某档及以上」同样比档高：p.level_rank >= (select s.rank from scale s where s.stream = 'level' and s.value = :band)。",
	],
};

/**
 * 命中表：一行是这条条件的「做过什么」在一段经历上命中的一条说法，每次检索由外壳按这条条件的
 * `seek` 物化，只能通过别名 `h` 读，不能在子查询里另外 from 它。
 */
export const HIT: CatalogRelation<
	"experience_id" | "emp_id" | "route" | "phrase" | "engagement"
> = {
	name: "hit",
	label: "命中",
	rows: "这条条件的 seek 在一段经历上命中的一条说法",
	columns: {
		experience_id: { type: "int", label: "段", meaning: "命中的段，等于 e.id" },
		emp_id: { type: "text", label: "工号", meaning: "命中的人" },
		route: {
			type: "text",
			label: "说法",
			meaning:
				"命中的是哪一类说法：role 公司内任职整句、title 入职前岗位名、skill 简历读出的能力词、description 没读过的简历原文",
			values: "enum",
		},
		phrase: {
			type: "text",
			label: "能力词",
			meaning: "命中的能力词原文，只有 skill 那类带",
		},
		engagement: {
			type: "text",
			label: "投入",
			meaning: "能力词的投入档：主导、做过、提到，只有 skill 那类带",
			values: "enum",
		},
	},
	notes: [
		"命中只说明这一段是候选；写了判据的条件，确认过符合的段才算数，排除也只认确认过符合的段。",
		"seek 没写 patterns 时每一段各有一行，route 是它登记的那条说法：公司内 role、入职前 title。",
		"一段可以有几行命中；外壳按段去重，留最对得上的一行。",
	],
};

/** 目录里的关系，按提示词里的顺序；`hit` 另列，只能经别名 `h` 读。 */
export const CATALOG: readonly CatalogRelation[] = [
	person,
	experience,
	rating,
	status,
	scale,
];

/**
 * 目录所在的 schema。生产是 `catalog`（`db/schema.ts`）；同一个库里要放几套目录时（比如每个
 * 测试文件一套）用 `TALENT_CATALOG_SCHEMA` 指定。
 */
export function catalogSchema(): string {
	const name = process.env.TALENT_CATALOG_SCHEMA?.trim() || "catalog";
	if (!/^[a-z_][a-z0-9_]*$/.test(name))
		throw new Error(`TALENT_CATALOG_SCHEMA 不是合法的 schema 名：${name}`);
	return name;
}

/** 一列的声明；目录里没有这个关系或这一列时为 undefined。 */
export function columnOf(relation: string, column: string) {
	const found = CATALOG.find((r) => r.name === relation);
	return found && Object.hasOwn(found.columns, column)
		? found.columns[column]
		: undefined;
}

/** 有高低的列的档高列：同一关系里和它并列声明的 `*_rank`。不是有高低的列为 null。 */
export function rankOf(relation: string, column: string): string | null {
	const declared = columnOf(relation, column);
	return declared?.values === "ordinal" ? declared.rank : null;
}

/** 目录写进提示词的样子：每个关系一段，列一行，口径跟在后面。 */
export function catalogText(): string {
	const relation = (r: CatalogRelation, alias: string) =>
		[
			`${r.name}（${r.label}，一行是${r.rows}${alias}）`,
			...Object.entries(r.columns).map(
				([name, c]) =>
					`  ${name} ${c.type}：${c.label}。${c.meaning}${c.values === "ordinal" ? "（有高低）" : c.values === "enum" ? "（有限取值）" : ""}`,
			),
			...r.notes.map((n) => `  · ${n}`),
		].join("\n");
	return [
		relation(person, "；人的条件里别名是 p"),
		relation(experience, "；经历条件里别名是 e"),
		relation(HIT, "；只在写了 seek 的经历条件里，别名是 h"),
		relation(rating, ""),
		relation(status, ""),
		relation(scale, ""),
	].join("\n\n");
}
