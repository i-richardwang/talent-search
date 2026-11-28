import { createHash } from "node:crypto";
export function contactKeys(contacts: { phone: string; email: string }) {
	const phone = contacts.phone
		.normalize("NFKC")
		.replace(/[^0-9]/g, "")
		.replace(/^(?:0086|86)(?=1\d{10}$)/, "");
	const email = contacts.email.normalize("NFKC").trim().toLowerCase();
	return Object.entries({ phone, email })
		.filter(([, v]) => v)
		.map(([kind, v]) => ({
			kind,
			value: createHash("sha256").update(v).digest("hex"),
		}));
}
