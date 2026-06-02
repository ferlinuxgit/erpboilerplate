"use client";

import { ResourceList, type ResourceListColumn } from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";

type TeamMemberRow = {
  membershipId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  userId: string;
  name: string;
  email: string;
};

type TeamMembersListProps = {
  rows: TeamMemberRow[];
};

const columns: ResourceListColumn<TeamMemberRow>[] = [
  {
    header: "Nombre",
    cell: (member) => (
      <div>
        <p className="font-medium">{member.name}</p>
        <p className="text-sm text-muted-foreground">{member.email}</p>
      </div>
    ),
    exportValue: (member) => member.name,
    sortValue: (member) => member.name,
  },
  {
    header: "Rol",
    cell: (member) => <StatusBadge tone={member.role === "OWNER" ? "success" : member.role === "ADMIN" ? "info" : "neutral"}>{member.role}</StatusBadge>,
    exportValue: (member) => member.role,
    sortValue: (member) => member.role,
  },
];

export function TeamMembersList({ rows }: TeamMembersListProps) {
  return (
    <ResourceList
      columns={columns}
      emptyDescription="Invita usuarios para colaborar dentro del tenant."
      emptyTitle="No hay miembros en el equipo."
      exportFileName="equipo.csv"
      getRowId={(member) => member.membershipId}
      getSearchText={(member) => [member.name, member.email, member.role].join(" ")}
      items={rows}
      searchPlaceholder="Buscar miembro por nombre, email o rol"
      testId="team-members-list"
      title="Miembros"
    />
  );
}
