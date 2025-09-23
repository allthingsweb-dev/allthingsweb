"use client";

import { Users, ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TeamManagement } from "@/app/[slug]/dashboard/team-management";
import type { ClientUser } from "@/lib/client-user";

interface TeamMember {
  hackId: string;
  userId: string;
}

interface Team {
  id: string;
  team_name: string;
  project_name?: string | null;
  project_description?: string | null;
  project_link?: string | null;
  team_image_url?: string | null;
  team_image_alt?: string | null;
}

interface TeamCardProps {
  team: Team;
  members: TeamMember[];
  user: ClientUser;
  isAdmin?: boolean;
  hasVotes?: boolean;
  userLookup?: Array<{ id: string; name: string | null }>;
  mode?: "default" | "voting" | "ended";
  voteButton?: React.ReactNode;
  voteCount?: number;
  onTeamDeleted?: () => void;
  onTeamUpdated?: () => void;
  className?: string;
}

export function TeamCard({
  team,
  members,
  user,
  isAdmin = false,
  hasVotes = false,
  userLookup = [],
  mode = "default",
  voteButton,
  voteCount,
  onTeamDeleted,
  onTeamUpdated,
  className = "",
}: TeamCardProps) {
  const isUserTeam = members.some((m) => m.userId === user.id);
  const canManageTeam = isUserTeam || isAdmin;

  const getUserName = (userId: string) => {
    if (userId === user.id) return "You";
    const foundUser = userLookup.find((u) => u.id === userId);
    return foundUser?.name || "Anonymous";
  };

  const teamMemberNames = members.map((member) => getUserName(member.userId));

  return (
    <Card
      className={`border-2 transition-colors ${
        isUserTeam
          ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950"
          : "hover:border-gray-300 dark:hover:border-gray-600"
      } ${className}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          {team.team_image_url ? (
            <Avatar className="w-12 h-12">
              <AvatarImage
                src={team.team_image_url}
                alt={team.team_image_alt || team.team_name}
              />
              <AvatarFallback>{team.team_name[0]}</AvatarFallback>
            </Avatar>
          ) : (
            <Avatar className="w-12 h-12">
              <AvatarFallback>{team.team_name[0]}</AvatarFallback>
            </Avatar>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <CardTitle className="text-base truncate flex items-center gap-2 min-w-0">
                <span className="truncate">{team.team_name}</span>
                {isUserTeam && (
                  <Badge variant="secondary" className="text-xs flex-shrink-0">
                    Your Team
                  </Badge>
                )}
              </CardTitle>
              {canManageTeam && (
                <div className="flex-shrink-0">
                  <TeamManagement
                    hackId={team.id}
                    teamName={team.team_name}
                    user={user}
                    hasVotes={hasVotes}
                    isAdmin={isAdmin}
                    onTeamDeleted={onTeamDeleted}
                    onTeamUpdated={onTeamUpdated}
                    userLookup={userLookup}
                    mode={mode}
                    voteButton={voteButton}
                  />
                </div>
              )}
            </div>
            {team.project_name && (
              <CardDescription className="text-sm truncate">
                {team.project_name}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span>Team Members:</span>
          <span className="text-foreground">
            {teamMemberNames.length > 0
              ? teamMemberNames.join(", ")
              : "No members"}
          </span>
          {mode === "voting" &&
            typeof voteCount === "number" &&
            voteCount !== undefined && (
              <>
                <span className="text-muted-foreground">•</span>
                <span className="text-primary font-semibold bg-primary/10 px-2 py-1 rounded-full text-xs">
                  {voteCount} vote{voteCount !== 1 ? "s" : ""}
                </span>
              </>
            )}
        </div>
        {team.project_description && (
          <p className="text-sm text-muted-foreground line-clamp-3">
            {team.project_description}
          </p>
        )}
        {team.project_link && (
          <a
            href={team.project_link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 hover:underline transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            Project link
          </a>
        )}
        {mode === "voting" && voteButton && !canManageTeam && (
          <div className="pt-3 border-t border-border">{voteButton}</div>
        )}
      </CardContent>
    </Card>
  );
}
