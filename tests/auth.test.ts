import assert from "node:assert/strict";
import { after, test } from "node:test";
import { isAdmin, loginDestination } from "#/lib/auth";
import { ORG, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
process.env.BETTER_AUTH_SECRET =
	"synthetic-auth-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3100";

const { getAuth, handleAuth } = await import("#/server/auth");
const { requireViewer, viewer } = await import("#/server/access");
const {
	changeOwnPassword,
	createUser,
	listAccounts,
	manageAccount,
	resetUserPassword,
	setUserDisabled,
	setUserRole,
	setUserScope,
} = await import("#/server/accounts");
const { listAudit } = await import("#/server/audit");
const { pool } = await import("#/db");
const PASSWORD = "Synthetic-login-42!";
const ORIGIN = "http://localhost:3100";
let requestNumber = 0;

function request(path: string, body?: unknown, cookie = "", origin = ORIGIN) {
	return handleAuth(
		new Request(`${ORIGIN}/api/auth${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers: {
				"content-type": "application/json",
				origin,
				cookie,
				"x-forwarded-for": `192.0.2.${++requestNumber}`,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
}

async function login(username: string, password = PASSWORD) {
	const response = await request("/sign-in/username", {
		username,
		password,
		role: "admin",
	});
	assert.equal(response.status, 200, await response.clone().text());
	const cookie = response.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
	assert.match(cookie, /session_token=/);
	assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
	return new Headers({ cookie });
}

test("只接受本站返回地址，角色必须完整匹配", () => {
	assert.equal(
		loginDestination("/data?q=sample%20user&page=2#detail"),
		"/data?q=sample%20user&page=2#detail",
	);
	for (const input of [
		undefined,
		"https://evil.example",
		"//evil.example",
		"/\\evil.example",
		"/%2fevil.example",
		"/%5cevil.example",
		"/%0a/evil.example",
		"/login",
		"/api/auth/sign-out",
		"/foo/../login",
		"/%",
	])
		assert.equal(loginDestination(input), "/");
	assert.equal(isAdmin("user,admin"), true);
	for (const role of [undefined, null, "user", "superadmin", "admin-copy"])
		assert.equal(isAdmin(role), false);
});

test("账号生命周期与权限检查不改变已有语料、抽取结果或词表", async () => {
	await seed([
		{
			personId: "synthetic-1",
			name: "合成员工",
			segments: [
				{
					kind: "external",
					title: "工程师",
					months: 20,
					description: "开发合成系统",
					extracted: { skills: ["合成技能"] },
				},
			],
		},
	]);
	await pool.query(
		"insert into term (word, canonical, parent, reviewed_at) values ('合成技能', '合成技能', null, now())",
	);
	await pool.query(
		"update experience set derived_identity = 'synthetic-derived'",
	);
	const corpus = async () => {
		const tables = [
			"employee",
			"experience",
			"experience_next",
			"experience_phrase",
			"experience_phrase_next",
			"phrase",
			"term",
		];
		return Promise.all(
			tables.map(
				async (table) =>
					(
						await pool.query(
							`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`,
						)
					).rows,
			),
		);
	};
	const before = await corpus();
	assert.equal(await viewer(new Headers()), null);
	await assert.rejects(
		requireViewer(
			new Headers({
				cookie: "better-auth.session_token=forged",
				"x-role": "admin",
			}),
		),
		(e: unknown) => e instanceof Response && e.status === 401,
	);
	await assert.rejects(
		manageAccount({
			action: "create",
			orgs: [ORG],
			username: "weak",
			password: "short",
		}),
		/密码/,
	);
	await manageAccount({
		action: "create",
		orgs: [ORG],
		username: "Sample.User",
		password: PASSWORD,
	});
	await manageAccount({
		action: "create",
		orgs: [ORG],
		username: "sample.admin",
		role: "admin",
		password: PASSWORD,
	});
	await assert.rejects(
		manageAccount({
			action: "create",
			orgs: [ORG],
			username: "SAMPLE.USER",
			password: PASSWORD,
		}),
	);
	const userHeaders = await login("SAMPLE.USER");
	const adminHeaders = await login("sample.admin");
	assert.equal(
		(await requireViewer(userHeaders)).admin,
		false,
		"登录载荷不能提权",
	);
	await assert.rejects(
		requireViewer(userHeaders, true),
		(e: unknown) => e instanceof Response && e.status === 403,
	);
	assert.equal((await requireViewer(adminHeaders, true)).name, "sample.admin");
	await pool.query(
		"update auth_user set role = 'user' where username = 'sample.admin'",
	);
	await assert.rejects(
		requireViewer(adminHeaders, true),
		(e: unknown) => e instanceof Response && e.status === 403,
	);
	await pool.query(
		"update auth_user set banned = true where username = 'sample.admin'",
	);
	assert.equal(await viewer(adminHeaders), null);
	await pool.query(
		"update auth_user set banned = false where username = 'sample.admin'",
	);
	await pool.query(
		`update auth_session set expires_at = now() - interval '1 minute'
		 where user_id = (select id from auth_user where username = 'sample.admin')`,
	);
	assert.equal(await viewer(adminHeaders), null);

	const wrong = await request("/sign-in/username", {
		username: "sample.user",
		password: "not-the-password",
	});
	assert.equal(wrong.status, 401);
	const crossSite = await request(
		"/sign-in/username",
		{ username: "sample.user", password: PASSWORD },
		userHeaders.get("cookie") ?? "",
		"https://evil.example",
	);
	assert.equal(crossSite.status, 403);
	for (const path of [
		"/sign-up/email",
		"/sign-in/email",
		"/admin/create-user",
		"/admin/set-role",
		"/is-username-available",
	])
		assert.equal(
			(
				await request(path, {
					username: "intruder",
					password: PASSWORD,
					role: "admin",
				})
			).status,
			404,
		);
	await assert.rejects(
		getAuth().api.signUpEmail({
			body: {
				email: "synthetic@example.invalid",
				name: "Synthetic",
				password: PASSWORD,
			},
		}),
	);

	const replacement = "Replacement-synthetic-42!";
	await manageAccount({
		action: "reset-password",
		username: "sample.user",
		password: replacement,
	});
	assert.equal(await viewer(userHeaders), null);
	assert.equal(
		(
			await request("/sign-in/username", {
				username: "sample.user",
				password: PASSWORD,
			})
		).status,
		401,
	);
	const fresh = await login("sample.user", replacement);
	assert.equal((await requireViewer(fresh)).name, "sample.user");
	assert.equal(
		(await request("/sign-out", {}, fresh.get("cookie") ?? "")).status,
		200,
	);
	assert.equal(await viewer(fresh), null);
	assert.deepEqual(await corpus(), before);
});

test("停用撤销登录并挡住再登录，恢复后照常；改角色下一次请求生效；账号不删除", async () => {
	await manageAccount({
		action: "create",
		orgs: [ORG],
		username: "leaving.user",
		name: "合成离职同事",
		password: PASSWORD,
	});
	const headers = await login("leaving.user");
	await manageAccount({ action: "disable", username: "Leaving.User" });
	assert.equal(await viewer(headers), null);
	const refused = await request("/sign-in/username", {
		username: "leaving.user",
		password: PASSWORD,
	});
	assert.notEqual(refused.status, 200);
	assert.equal(refused.headers.getSetCookie().length, 0);
	assert.deepEqual((await listAccounts("离职", 1)).rows, [
		{
			username: "leaving.user",
			name: "合成离职同事",
			admin: false,
			disabled: true,
			orgs: [ORG],
			people: 1,
		},
	]);

	await manageAccount({ action: "enable", username: "leaving.user" });
	const back = await login("leaving.user");
	await manageAccount({
		action: "set-role",
		username: "leaving.user",
		role: "admin",
	});
	assert.equal((await requireViewer(back, true)).admin, true);
	await manageAccount({
		action: "set-role",
		username: "leaving.user",
		role: "user",
	});
	await assert.rejects(
		requireViewer(back, true),
		(e: unknown) => e instanceof Response && e.status === 403,
	);
	await assert.rejects(
		manageAccount({
			action: "set-role",
			username: "leaving.user",
			role: "owner",
		}),
		/角色/,
	);
	await assert.rejects(
		manageAccount({ action: "disable", username: "nobody.here" }),
		/用户名不存在/,
	);
});

test("改自己的密码要当前密码；改完别处的登录失效，旧密码不能再用", async () => {
	await manageAccount({
		action: "create",
		orgs: [ORG],
		username: "changing.user",
		password: PASSWORD,
	});
	const here = await login("changing.user");
	const elsewhere = await login("changing.user");
	const next = "Changed-synthetic-42!";
	assert.equal(
		await changeOwnPassword(here, "not-the-password", next),
		"wrong",
	);
	assert.equal(await changeOwnPassword(here, PASSWORD, "short"), "length");
	assert.ok(await viewer(elsewhere), "没改成时别处的登录还在");
	assert.equal(await changeOwnPassword(here, PASSWORD, next), null);
	assert.equal(await viewer(elsewhere), null);
	assert.equal(
		(
			await request("/sign-in/username", {
				username: "changing.user",
				password: PASSWORD,
			})
		).status,
		401,
	);
	await login("changing.user", next);
	assert.equal(
		(
			await request(
				"/change-password",
				{ currentPassword: next, newPassword: PASSWORD },
				here.get("cookie") ?? "",
			)
		).status,
		404,
		"认证接口不直接开放改密码：只走服务端函数，由它撤销别处的登录",
	);
});

test("账号页管别人的账号：建号和重置交出生成的密码，改角色、停用恢复照常，自己的账号动不了，每件都记进操作记录", async () => {
	await manageAccount({
		action: "create",
		orgs: [ORG],
		username: "page.admin",
		name: "合成管理员",
		role: "admin",
		password: PASSWORD,
	});
	const adminId = (
		await pool.query<{ id: string }>(
			"select id from auth_user where username = 'page.admin'",
		)
	).rows[0]?.id;
	assert.ok(adminId);

	await seed([
		{
			personId: "P1",
			name: "合成员工甲",
			org: `${ORG}>出行事业部>运营部`,
			segments: [],
		},
		{
			personId: "P2",
			name: "合成员工乙",
			org: `${ORG}>金融事业部`,
			segments: [],
		},
	]);
	const moving = `${ORG}>出行事业部`;
	await assert.rejects(
		createUser(adminId, "page.user", "", false, []),
		/数据范围/,
		"建账号必须给数据范围",
	);
	await assert.rejects(
		createUser(adminId, "page.user", "", false, [`${ORG}>没有这个部门`]),
		/组织树上没有/,
	);
	const initial = await createUser(adminId, " Page.User ", "", false, [
		` ${moving} > 运营部 `,
		moving,
	]);
	assert.ok(initial && initial.length === 16);
	assert.equal(
		await createUser(adminId, "PAGE.USER", "合成重名", false, [ORG]),
		null,
	);
	await assert.rejects(createUser(adminId, "x", "", false, [ORG]), /用户名/);
	assert.deepEqual((await listAccounts("page.user", 1)).rows, [
		{
			username: "page.user",
			name: "page.user",
			admin: false,
			disabled: false,
			orgs: [moving],
			people: 1,
		},
	]);
	await setUserScope(adminId, "page.user", [`${ORG}>金融事业部`, moving]);
	assert.equal((await listAccounts("page.user", 1)).rows[0]?.people, 2);
	const headers = await login("page.user", initial);
	assert.equal((await requireViewer(headers)).admin, false);

	const replacement = await resetUserPassword(adminId, "page.user");
	assert.notEqual(replacement, initial);
	assert.equal(await viewer(headers), null, "重置撤销原来的登录");
	assert.equal(
		(
			await request("/sign-in/username", {
				username: "page.user",
				password: initial,
			})
		).status,
		401,
	);
	const again = await login("page.user", replacement);
	await setUserDisabled(adminId, "page.user", true);
	assert.equal(await viewer(again), null, "停用撤销登录");
	await setUserDisabled(adminId, "page.user", false);
	const back = await login("page.user", replacement);
	await setUserRole(adminId, "page.user", true);
	assert.equal(
		(await requireViewer(back, true)).admin,
		true,
		"下一次请求就是管理员",
	);
	await setUserRole(adminId, "page.user", false);
	assert.equal((await requireViewer(back)).admin, false);

	const second = await createUser(
		adminId,
		"page.second",
		"合成第二管理员",
		true,
		[ORG],
	);
	assert.ok(second);
	assert.equal(
		(await requireViewer(await login("page.second", second), true)).admin,
		true,
	);
	assert.ok(
		await resetUserPassword(adminId, "page.second"),
		"别的管理员也能管",
	);

	for (const attempt of [
		() => resetUserPassword(adminId, "page.admin"),
		() => setUserRole(adminId, "page.admin", false),
		() => setUserDisabled(adminId, "page.admin", true),
		() => setUserScope(adminId, "page.admin", [ORG]),
	])
		await assert.rejects(attempt(), /不能在账号页改自己的账号/);
	await assert.rejects(
		setUserDisabled(adminId, "nobody.here", true),
		/用户名不存在/,
	);

	assert.deepEqual(
		(await listAudit("page.", 1)).rows.map((row) => [
			row.username,
			row.action,
			row.accountUsername,
		]),
		[
			["page.admin", "reset-password", "page.second"],
			["page.admin", "grant-admin", "page.second"],
			["page.admin", "create-account", "page.second"],
			["page.admin", "revoke-admin", "page.user"],
			["page.admin", "grant-admin", "page.user"],
			["page.admin", "enable-account", "page.user"],
			["page.admin", "disable-account", "page.user"],
			["page.admin", "reset-password", "page.user"],
			["page.admin", "set-scope", "page.user"],
			["page.admin", "create-account", "page.user"],
		],
		"被拒绝和没建成的不留痕",
	);
});

test("两个管理员同时互相取消管理员：一个成，一个被拒，总剩一个管理员", async () => {
	const admin = async (username: string) => {
		await manageAccount({
			action: "create",
			orgs: [ORG],
			username,
			role: "admin",
			password: PASSWORD,
		});
		const { rows } = await pool.query<{ id: string }>(
			"select id from auth_user where username = $1",
			[username],
		);
		const id = rows[0]?.id;
		assert.ok(id);
		return id;
	};
	const a = await admin("duel.a");
	const b = await admin("duel.b");
	const outcomes = await Promise.allSettled([
		setUserRole(a, "duel.b", false),
		setUserRole(b, "duel.a", false),
	]);
	assert.deepEqual(outcomes.map((o) => o.status).sort(), [
		"fulfilled",
		"rejected",
	]);
	for (const outcome of outcomes)
		if (outcome.status === "rejected")
			assert.match(String(outcome.reason), /只有在用的管理员能管理账号/);
	const { rows } = await pool.query<{ n: number }>(
		"select count(*)::int as n from auth_user where username like 'duel.%' and role = 'admin'",
	);
	assert.equal(rows[0]?.n, 1);
});

test("同一来源连续尝试登录会被限流", async () => {
	const statuses: number[] = [];
	for (let i = 0; i < 6; i++) {
		const response = await handleAuth(
			new Request(`${ORIGIN}/api/auth/sign-in/username`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: ORIGIN,
					"x-forwarded-for": "192.0.2.250",
				},
				body: JSON.stringify({ username: "missing.user", password: PASSWORD }),
			}),
		);
		statuses.push(response.status);
		if (response.status === 429) break;
	}
	assert.equal(statuses[0], 401);
	assert.equal(statuses.at(-1), 429);
});
