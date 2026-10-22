import assert from "node:assert/strict";
import { after, test } from "node:test";
import { isAdmin, loginDestination } from "#/lib/auth";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
process.env.BETTER_AUTH_SECRET =
	"synthetic-auth-test-secret-at-least-32-characters";
process.env.BETTER_AUTH_URL = "http://localhost:3100";

const { getAuth, handleAuth } = await import("#/server/auth");
const { requireViewer, viewer } = await import("#/server/access");
const { manageAccount } = await import("#/server/accounts");
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
			empId: "synthetic-1",
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
		"insert into phrase_gloss (text, gloss, guide_identity) values ('合成技能', '合成测试释义', 'synthetic-guide')",
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
			"phrase_gloss",
			"embedding_space",
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
		manageAccount({ action: "create", username: "weak", password: "short" }),
		/密码/,
	);
	const user = await manageAccount({
		action: "create",
		username: "Sample.User",
		password: PASSWORD,
	});
	const admin = await manageAccount({
		action: "create",
		username: "sample.admin",
		role: "admin",
		password: PASSWORD,
	});
	await assert.rejects(
		manageAccount({
			action: "create",
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
	assert.equal((await requireViewer(adminHeaders, true)).id, admin.id);
	await pool.query("update auth_user set role = 'user' where id = $1", [
		admin.id,
	]);
	await assert.rejects(
		requireViewer(adminHeaders, true),
		(e: unknown) => e instanceof Response && e.status === 403,
	);
	await pool.query("update auth_user set banned = true where id = $1", [
		admin.id,
	]);
	assert.equal(await viewer(adminHeaders), null);
	await pool.query("update auth_user set banned = false where id = $1", [
		admin.id,
	]);
	await pool.query(
		"update auth_session set expires_at = now() - interval '1 minute' where user_id = $1",
		[admin.id],
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
	assert.equal((await requireViewer(fresh)).id, user.id);
	assert.equal(
		(await request("/sign-out", {}, fresh.get("cookie") ?? "")).status,
		200,
	);
	assert.equal(await viewer(fresh), null);
	assert.deepEqual(await corpus(), before);
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
