"use client";

import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { TeamMemberActions } from "@/components/settings/team-member-actions";

type TeamMemberRow = {
  membershipId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  userId: string;
  name: string;
  email: string;
};

type TeamMembersListProps = {
  canManage: boolean;
  canAssignOwner: boolean;
  rows: TeamMemberRow[];
};

const columns = (
  canManage: boolean,
  canAssignOwner: boolean,
): ResourceListColumn<TeamMemberRow>[] => [
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
    cell: (member) => (
      <StatusBadge
        tone={
          member.role === "OWNER"
            ? "success"
            : member.role === "ADMIN"
              ? "info"
              : "neutral"
        }
      >
        {member.role}
      </StatusBadge>
    ),
    exportValue: (member) => member.role,
    sortValue: (member) => member.role,
  },
  ...(canManage
    ? [
        {
          header: "Acciones",
          className: "text-right",
          cell: (member: TeamMemberRow) => (
            <TeamMemberActions
              canAssignOwner={canAssignOwner}
              membershipId={member.membershipId}
              role={member.role}
            />
          ),
        },
      ]
    : []),
];

export function TeamMembersList({
  canAssignOwner,
  canManage,
  rows,
}: TeamMembersListProps) {
  return (
    <ResourceList
      columns={columns(canManage, canAssignOwner)}
      emptyDescription="Invita usuarios para colaborar dentro del espacio de trabajo."
      emptyTitle="No hay miembros en el equipo."
      exportFileName="equipo.csv"
      getRowId={(member) => member.membershipId}
      getSearchText={(member) =>
        [member.name, member.email, member.role].join(" ")
      }
      items={rows}
      searchPlaceholder="Buscar miembro por nombre, email o rol"
      testId="team-members-list"
      title="Miembros"
    />
  );
}
