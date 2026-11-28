import { DescriptionsItem } from "#/components/ui/descriptions";
import { dots } from "#/lib/format";
import type { PersonDetail } from "#/search/result";

export function ExternalProfile({
	person,
}: {
	person: PersonDetail["person"];
}) {
	return (
		<>
			<DescriptionsItem label="最近公司">
				{person.recentCompany || "—"}
			</DescriptionsItem>
			<DescriptionsItem label="最近岗位">
				{person.recentTitle || "—"}
			</DescriptionsItem>
			<DescriptionsItem label="所属人才池">
				{person.pools.join("、") || "—"}
			</DescriptionsItem>
			<DescriptionsItem label="学历">
				{dots(person.educationLevel, person.school, person.schoolTier) || "—"}
			</DescriptionsItem>
		</>
	);
}
