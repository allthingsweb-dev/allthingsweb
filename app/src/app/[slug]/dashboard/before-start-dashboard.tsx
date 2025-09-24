"use client";

import Link from "next/link";
import { useLiveQuery } from "@tanstack/react-db";
import { eq } from "@tanstack/db";
import {
  Calendar,
  MapPin,
  Users,
  Clock,
  ExternalLink,
  Trophy,
} from "lucide-react";
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
import {
  hacksCollection,
  hackUsersCollection,
  hackVotesCollection,
  hackImagesCollection,
  awardsCollection,
} from "@/lib/hackathons/collections";
import { toReadableDateTimeStr } from "@/lib/datetime";
import { RegisterTeamModal } from "./register-team-modal";
import type { ExpandedEvent } from "@/lib/expanded-events";
import type { ClientUser } from "@/lib/client-user";
import { EditTeamModal } from "./edit-team-modal";
import { TeamManagement } from "./team-management";
import { useUsers } from "@/hooks/use-users";
import { getUserDisplayName } from "@/lib/display-name-utils";

interface BeforeStartDashboardProps {
  event: ExpandedEvent;
  user: ClientUser;
  isAdmin: boolean;
}

export function BeforeStartDashboard({
  event,
  user,
  isAdmin,
}: BeforeStartDashboardProps) {
  const { users } = useUsers();
  // Helper function to look up user name by ID
  const getUserName = (userId: string): string => {
    if (userId === user.id) return "You";
    const userInfo = users.find((u) => u.id === userId);
    return userInfo ? getUserDisplayName(userInfo) : "Anonymous";
  };
  // Get all registered teams for this event with their images
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
  console.log("teams", teams);

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

  // Get votes for user's team to check if deletion is allowed
  const { data: teamVotes } = useLiveQuery((q) =>
    userTeam
      ? q
          .from({ vote: hackVotesCollection })
          .where(({ vote }) => eq(vote.hack_id, userTeam.hackId))
      : q
          .from({ vote: hackVotesCollection })
          .where(({ vote }) => eq(vote.hack_id, "never-match")),
  );

  // Get all votes for all teams to check which teams have votes
  const { data: allVotes } = useLiveQuery((q) =>
    q
      .from({ vote: hackVotesCollection })
      .join({ hack: hacksCollection }, ({ vote, hack }) =>
        eq(vote.hack_id, hack.id),
      )
      .where(({ hack }) => eq(hack!.event_id, event.id)),
  );

  // Get awards for this event
  const { data: awards } = useLiveQuery((q) =>
    q
      .from({ award: awardsCollection })
      .where(({ award }) => eq(award.event_id, event.id)),
  );

  const userTeamHasVotes = teamVotes && teamVotes.length > 0;

  return (
    <div className="w-full max-w-none px-4 sm:px-6 lg:px-8 space-y-8">
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
              Register on Luma
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>

      {/* User Team Status */}
      {userTeam && (
        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950">
          <CardHeader>
            <CardTitle className="text-green-800 dark:text-green-200 flex items-center gap-2">
              <Users className="h-5 w-5" />
              You're Registered!
            </CardTitle>
            <CardDescription className="text-green-700 dark:text-green-300">
              You're part of team: <strong>{userTeam.teamName}</strong>
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Event Details and Awards */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Event Schedule & Location */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Event Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Location Section */}
            <div className="pb-3 border-b border-border">
              <div className="flex items-center gap-3 mb-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <p className="font-medium text-foreground">Location</p>
              </div>
              <div className="pl-7 space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {event.shortLocation}
                </p>
                {event.streetAddress && (
                  <p className="text-sm text-muted-foreground">
                    {event.streetAddress}
                  </p>
                )}
              </div>
            </div>

            {/* Schedule Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-foreground">Event Start</p>
                  <p className="text-sm text-muted-foreground">
                    {toReadableDateTimeStr(event.startDate)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-foreground">Event End</p>
                  <p className="text-sm text-muted-foreground">
                    {toReadableDateTimeStr(event.endDate)}
                  </p>
                </div>
              </div>
              {event.hackUntil && (
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                  <div>
                    <p className="font-medium text-foreground">
                      Hacking Deadline
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {toReadableDateTimeStr(event.hackUntil)}
                    </p>
                  </div>
                </div>
              )}
              {event.voteUntil && (
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-yellow-500 dark:text-yellow-400" />
                  <div>
                    <p className="font-medium text-foreground">
                      Voting Deadline
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {toReadableDateTimeStr(event.voteUntil)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Awards */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Awards
              <Badge variant="secondary">{awards?.length || 0}</Badge>
            </CardTitle>
            <CardDescription>
              Awards available for this hackathon
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!awards || awards.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Trophy className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No awards announced yet</p>
                <p className="text-sm">Awards will be announced soon!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {awards.map((award, index) => (
                  <div
                    key={award.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-950 dark:to-orange-950 border border-yellow-200 dark:border-yellow-800"
                  >
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-r from-yellow-400 to-orange-400 dark:from-yellow-500 dark:to-orange-500 flex items-center justify-center">
                        <span className="text-white font-bold text-sm">
                          {index + 1}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-foreground">
                        {award.name}
                      </p>
                    </div>
                    <Trophy className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Registered Teams */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Teams
            <Badge variant="secondary">{teams?.length || 0}</Badge>
          </CardTitle>
          <CardDescription>
            Teams that have registered for this hackathon
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!teams || teams.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No teams registered yet</p>
              <p className="text-sm">Be the first to register your team!</p>
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
