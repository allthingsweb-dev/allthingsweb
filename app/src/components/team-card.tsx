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
import { getUserDisplayName } from "@/lib/display-name-utils";

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
  userLookup?: ClientUser[]; // Updated to use full ClientUser data
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
    return foundUser ? getUserDisplayName(foundUser) : "Anonymous";
  };

  const teamMemberNames = members.map((member) => getUserName(member.userId));

  return (
    <Card
      className={`border-2 transition-all duration-200 shadow-sm hover:shadow-md ${
        isUserTeam
          ? "border-blue-500 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-950/50 ring-1 ring-blue-200 dark:ring-blue-800"
          : "border-border hover:border-primary/20 dark:hover:border-primary/30 hover:shadow-primary/5"
      } ${className}`}
    >
      <CardHeader className="pb-4">
        <div className="flex items-start gap-4">
          {team.team_image_url ? (
            <Avatar className="w-14 h-14 ring-2 ring-border">
              <AvatarImage
                src={team.team_image_url}
                alt={team.team_image_alt || team.team_name}
              />
              <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
                {team.team_name[0]}
              </AvatarFallback>
            </Avatar>
          ) : (
            <Avatar className="w-14 h-14 ring-2 ring-border">
              <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
                {team.team_name[0]}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <CardTitle className="text-lg font-bold truncate text-foreground">
                  {team.team_name}
                </CardTitle>
                {isUserTeam && (
                  <Badge
                    variant="default"
                    className="text-xs font-medium bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                  >
                    Your Team
                  </Badge>
                )}
              </div>
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
                    mode={mode}
                    voteButton={voteButton}
                  />
                </div>
              )}
            </div>
            {team.project_name && (
              <CardDescription className="text-sm font-medium text-foreground/80 dark:text-foreground/90">
                {team.project_name}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {/* Project Description and Link - Moved above team members */}
        {(team.project_description || team.project_link) && (
          <div className="space-y-3 pb-4 border-b border-border/50">
            {team.project_description && (
              <p className="text-sm text-foreground/75 dark:text-foreground/85 line-clamp-3 leading-relaxed">
                {team.project_description}
              </p>
            )}
            {team.project_link && (
              <a
                href={team.project_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 hover:underline transition-colors px-3 py-1.5 bg-primary/5 hover:bg-primary/10 rounded-md border border-primary/20"
              >
                <ExternalLink className="h-4 w-4" />
                View Project
              </a>
            )}
          </div>
        )}

        {/* Team Members */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground/70 dark:text-foreground/80">
            <Users className="h-4 w-4" />
            <span>Team Members</span>
            {mode === "voting" &&
              typeof voteCount === "number" &&
              voteCount !== undefined && (
                <>
                  <span className="text-muted-foreground">•</span>
                  <Badge
                    variant="outline"
                    className="text-xs font-semibold text-primary border-primary/30"
                  >
                    {voteCount} vote{voteCount !== 1 ? "s" : ""}
                  </Badge>
                </>
              )}
          </div>
          <div className="text-sm font-medium text-foreground dark:text-foreground">
            {teamMemberNames.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {teamMemberNames.map((name, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-secondary/60 dark:bg-secondary/40 text-secondary-foreground dark:text-secondary-foreground border border-secondary-foreground/20"
                  >
                    {name}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground text-xs italic">
                No members yet
              </span>
            )}
          </div>
        </div>

        {/* Voting Button */}
        {mode === "voting" && voteButton && !canManageTeam && (
          <div className="pt-3 border-t border-border/50">{voteButton}</div>
        )}
      </CardContent>
    </Card>
  );
}
