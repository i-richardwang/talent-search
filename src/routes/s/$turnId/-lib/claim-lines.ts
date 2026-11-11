import { bestEvidencePerClaim } from "#/search/evidence";
import type { Claim } from "#/search/query";
import type { ClaimBasis, Evidence, RankedResult } from "#/search/result";

/**
 * 一条主张在一个人身上的样子：命中了带着排在最前的那一段证据（`evidence`）、算数的
 * 段数（`segments`）和聚合依据（`basis`），没命中是 null。名单那一行、它的依据气泡和
 * 导出读的都是这一份。
 */
export type ClaimLine = {
	claim: Claim;
	found: { evidence: Evidence; segments: number; basis: ClaimBasis } | null;
};

/**
 * 一个人在各条主张上的证据，和 `claims` 同序。按人排的名单没有证据，传 `null`，
 * 每一条都是未命中。一条主张的样例段和聚合依据缺一个就算未命中。
 */
export function claimLines(
	ranked: RankedResult | null,
	claims: Claim[],
): ClaimLine[] {
	const all = ranked?.evidence ?? [];
	const best = bestEvidencePerClaim(all, claims);
	return claims.map((claim, i) => {
		const evidence = best[i];
		const basis = ranked?.basis[i];
		if (!evidence || !basis) return { claim, found: null };
		const segments = countedOf(all.filter((e) => e.claim === i)).size;
		return { claim, found: { basis, evidence, segments } };
	});
}

/** 一个人在当前检索里算数的经历段，不管它为哪几条主张算数。 */
export function countedOf(evidence: Evidence[]): ReadonlySet<number> {
	return new Set(evidence.map((e) => e.experienceId));
}
