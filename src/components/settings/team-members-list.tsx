"use client";

import {
  ResourceList,
  type ResourceListColumn,
} from "@/components/ui/resource-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { TeamMemberActions } from "@/components/settings/team-member-actions";
import { roleDescriptions, type AppRole } from "@/lib/rbac";
import { roleLabels, statusLabel } from "@/lib/status-labels";

type TeamMemberRow = {
  membershipId: string;
  role: AppRole;
  userId: string;
  name: string;
  email: string;
};

type TeamMembersListProps = {
  actorRole: AppRole;
  canManage: boolean;
  currentUserId: string;
  rows: TeamMemberRow[];
};

const columns = (
  canManage: boolean,
  actorRole: AppRole,
  currentUserId: string,
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
        {statusLabel(roleLabels, member.role)}
      </StatusBadge>
    ),
    exportValue: (member) => statusLabel(roleLabels, member.role),
    sortValue: (member) => member.role,
  },
  {
    header: "Qué puede hacer",
    cell: (member) => <p className="max-w-md text-xs text-muted-foreground">{roleDescriptions[member.role] ?? ""}</p>,
    exportValue: (member) => roleDescriptions[member.role] ?? "",
  },
  ...(canManage
    ? [
        {
          header: "Acciones",
          className: "text-right",
          cell: (member: TeamMemberRow) =>
            member.userId === currentUserId ? (
              <span className="text-xs text-muted-foreground">Tú</span>
            ) : (
              <TeamMemberActions actorRole={actorRole} membershipId={member.membershipId} role={member.role} />
            ),
        },
      ]
    : []),
];

export function TeamMembersList({
  actorRole,
  canManage,
  currentUserId,
  rows,
}: TeamMembersListProps) {
  return (
    <ResourceList
      columns={columns(canManage, actorRole, currentUserId)}
      emptyDescription="Invita usuarios para colaborar dentro del espacio de trabajo."
      emptyTitle="No hay miembros en el equipo."
      exportFileName="equipo.csv"
      getRowId={(member) => member.membershipId}
      getSearchText={(member) =>
        [member.name, member.email, member.role, statusLabel(roleLabels, member.role)].join(" ")
      }
      items={rows}
      searchPlaceholder="Buscar miembro por nombre, email o rol"
      testId="team-members-list"
      title="Miembros"
    />
  );
}
