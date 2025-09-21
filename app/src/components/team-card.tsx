"use client";

import { Users } from "lucide-react";
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
        isUserTeam ? "border-blue-300 bg-blue-50" : "hover:border-gray-300"
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
            <CardTitle className="text-base truncate flex items-center gap-2">
              {team.team_name}
              {isUserTeam && (
                <Badge variant="secondary" className="text-xs">
                  Your Team
                </Badge>
              )}
              {canManageTeam && (
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
              )}
            </CardTitle>
            {team.project_name && (
              <CardDescription className="text-sm truncate">
                {team.project_name}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Users className="h-4 w-4" />
          <span>Team Members:</span>
          <span className="text-gray-700">
            {teamMemberNames.length > 0
              ? teamMemberNames.join(", ")
              : "No members"}
          </span>
          {mode === "voting" && typeof voteCount === "number" && (
            <>
              <span className="text-gray-400">•</span>
              <span className="text-blue-600 font-medium">
                {voteCount} vote{voteCount !== 1 ? "s" : ""}
              </span>
            </>
          )}
        </div>
        {team.project_description && (
          <p className="text-sm text-gray-500 line-clamp-3">
            {team.project_description}
          </p>
        )}
        {mode === "voting" && voteButton && !canManageTeam && (
          <div className="pt-2">{voteButton}</div>
        )}
      </CardContent>
    </Card>
  );
}
