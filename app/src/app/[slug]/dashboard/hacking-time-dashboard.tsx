"use client";

import Link from "next/link";
import { useLiveQuery } from "@tanstack/react-db";
import { eq } from "@tanstack/db";
import { Users, ExternalLink, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  hacksCollection,
  hackUsersCollection,
  hackVotesCollection,
  hackImagesCollection,
} from "@/lib/hackathons/collections";
import { CountdownTimer } from "./countdown-timer";
import { RegisterTeamModal } from "./register-team-modal";
import type { ExpandedEvent } from "@/lib/expanded-events";
import type { ClientUser } from "@/lib/client-user";
import { TeamManagement } from "./team-management";
import { useUsers } from "@/hooks/use-users";
import { getUserDisplayName } from "@/lib/display-name-utils";

interface HackingTimeDashboardProps {
  event: ExpandedEvent;
  user: ClientUser;
  isAdmin: boolean;
}

export function HackingTimeDashboard({
  event,
  user,
  isAdmin,
}: HackingTimeDashboardProps) {
  const { users } = useUsers();
  // Helper function to look up user name by ID
  const getUserName = (userId: string): string => {
    if (userId === user.id) return "You";
    const userInfo = users.find((u) => u.id === userId);
    return userInfo ? getUserDisplayName(userInfo) : "Anonymous";
  };
  // Get all teams for this event with their images
  const { data: teams } = useLiveQuery((q) =>
    q
      .from({ hack: hacksCollection })
      .leftJoin({ image: hackImagesCollection }, ({ hack, image }) =>
        eq(hack.team_image, image.id),
      )
      .where(({ hack }) => eq(hack.event_id, event.id))
      .orderBy(({ hack }) => hack.created_at, "desc")
      .select(({ hack, image }) => ({
        id: hack.id,
        event_id: hack.event_id,
        team_name: hack.team_name,
        project_name: hack.project_name,
        project_description: hack.project_description,
        team_image: hack.team_image,
        team_image_url: image?.url,
        team_image_alt: image?.alt,
        created_at: hack.created_at,
        updated_at: hack.updated_at,
      })),
  );

  // Get team members for all teams
  const { data: teamMembers } = useLiveQuery((q) =>
    q
      .from({ member: hackUsersCollection })
      .join(
        { hack: hacksCollection },
        ({ member, hack }) => eq(member.hack_id, hack.id),
        "inner",
      )
      .where(({ hack }) => eq(hack.event_id, event.id))
      .select(({ member, hack }) => ({
        hackId: member.hack_id,
        userId: member.user_id,
        teamName: hack.team_name,
      })),
  );

  // Check if current user is already on a team
  const userTeam = teamMembers?.find((member) => member.userId === user.id);

  // Get all votes for all teams to check which teams have votes
  const { data: allVotes } = useLiveQuery((q) =>
    q
      .from({ vote: hackVotesCollection })
      .join({ hack: hacksCollection }, ({ vote, hack }) =>
        eq(vote.hack_id, hack.id),
      )
      .where(({ hack }) => eq(hack!.event_id, event.id)),
  );

  // Get hacking deadline
  const hackingDeadline = event.hackUntil
    ? new Date(event.hackUntil)
    : new Date(event.endDate);

  return (
    <div className="w-full max-w-none px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Countdown Timer */}
      <CountdownTimer
        targetDate={hackingDeadline}
        title="Hacking Time Remaining"
        subtitle="Make it count! Build something amazing."
        timerType="hackathon"
      />

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        {!userTeam && (
          <RegisterTeamModal
            eventId={event.id}
            eventSlug={event.slug}
            user={user}
          />
        )}

        {event.lumaEventUrl && (
          <Button
            asChild
            variant="outline"
            size="lg"
            className="flex-1 sm:flex-none"
          >
            <Link
              href={event.lumaEventUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              View on Luma
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>

      {/* All Teams */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            All Teams
            <Badge variant="secondary">{teams?.length || 0}</Badge>
          </CardTitle>
          <CardDescription>
            Teams participating in this hackathon
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!teams || teams.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No teams registered yet</p>
              <p className="text-sm">Be the first to register!</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-[280px]">
              {teams.map((team) => {
                const members =
                  teamMembers?.filter((m) => m.hackId === team.id) || [];
                const isUserTeam = members.some((m) => m.userId === user.id);
                const canManageTeam = isUserTeam || isAdmin;
                const teamHasVotes =
                  allVotes?.some((vote) => vote.vote.hack_id === team.id) ||
                  false;

                return (
                  <Card
                    key={team.id}
                    className={`border-2 transition-all duration-200 shadow-sm hover:shadow-md ${
                      isUserTeam
                        ? "border-blue-500 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-950/50 ring-1 ring-blue-200 dark:ring-blue-800"
                        : "border-border hover:border-primary/20 dark:hover:border-primary/30 hover:shadow-primary/5"
                    }`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start gap-3">
                        {team.team_image_url ? (
                          <Avatar className="w-12 h-12 ring-2 ring-border">
                            <AvatarImage
                              src={team.team_image_url}
                              alt={team.team_image_alt || team.team_name}
                            />
                            <AvatarFallback className="text-base font-semibold bg-primary/10 text-primary">
                              {team.team_name[0]}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <Avatar className="w-12 h-12 ring-2 ring-border">
                            <AvatarFallback className="text-base font-semibold bg-primary/10 text-primary">
                              {team.team_name[0]}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <CardTitle className="text-base font-bold truncate text-foreground">
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
                                  hasVotes={teamHasVotes}
                                  isAdmin={isAdmin}
                                  onTeamDeleted={() => {
                                    // TanStack DB will automatically update via live queries
                                  }}
                                  onTeamUpdated={() => {
                                    // TanStack DB will automatically update via live queries
                                  }}
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
                    <CardContent className="space-y-3 pt-0">
                      {team.project_description && (
                        <p className="text-sm text-foreground/75 dark:text-foreground/85 line-clamp-2 leading-relaxed">
                          {team.project_description}
                        </p>
                      )}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground/70 dark:text-foreground/80">
                          <Users className="h-4 w-4" />
                          <span>Team Members</span>
                        </div>
                        {members.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {members.map((member) => (
                              <span
                                key={member.userId}
                                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-secondary/60 dark:bg-secondary/40 text-secondary-foreground dark:text-secondary-foreground border border-secondary-foreground/20"
                              >
                                {getUserName(member.userId)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs italic">
                            No members yet
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
