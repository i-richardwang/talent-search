import { bestEvidencePerClaim } from "#/search/evidence";
import type { Claim } from "#/search/query";
import type { ClaimBasis, Evidence, RankedResult } from "#/search/result";

/**
 * 一条主张在一个人身上的样子：命中了带着排在最前的那一段证据（`evidence`）和聚合依据
 * （`basis`），没命中是 null。名单那一行、它的依据气泡、人的详情和导出读的都是这一份。
 */
export type ClaimLine = {
	claim: Claim;
	found: { evidence: Evidence; basis: ClaimBasis } | null;
};

/**
 * 一个人在各条主张上的证据，和 `claims` 同序。按人排的名单没有证据，传 `null`，
 * 每一条都是未命中。一条主张的样例段和聚合依据缺一个就算未命中。
 */
export function claimLines(
	ranked: RankedResult | null,
	claims: Claim[],
): ClaimLine[] {
	const best = bestEvidencePerClaim(ranked?.evidence ?? [], claims);
	return claims.map((claim, i) => {
		const evidence = best[i];
		const basis = ranked?.basis[i];
		return {
			claim,
			found: evidence && basis ? { basis, evidence } : null,
		};
	});
}
