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
import type { UserLookup } from "@/lib/users";
import { EditTeamModal } from "./edit-team-modal";
import { TeamManagement } from "./team-management";

interface BeforeStartDashboardProps {
  event: ExpandedEvent;
  user: ClientUser;
  isAdmin: boolean;
  userLookup: UserLookup[];
}

export function BeforeStartDashboard({
  event,
  user,
  isAdmin,
  userLookup,
}: BeforeStartDashboardProps) {
  // Helper function to look up user name by ID
  const getUserName = (userId: string): string => {
    if (userId === user.id) return "You";
    const userInfo = userLookup.find((u) => u.id === userId);
    return userInfo?.name || "Anonymous";
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
    <div className="space-y-8">
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
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-800 flex items-center gap-2">
              <Users className="h-5 w-5" />
              You're Registered!
            </CardTitle>
            <CardDescription>
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
            <div className="pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3 mb-2">
                <MapPin className="h-4 w-4 text-gray-500" />
                <p className="font-medium">Location</p>
              </div>
              <div className="pl-7 space-y-1">
                <p className="text-sm font-medium">{event.shortLocation}</p>
                {event.streetAddress && (
                  <p className="text-sm text-gray-600">{event.streetAddress}</p>
                )}
              </div>
            </div>

            {/* Schedule Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-gray-500" />
                <div>
                  <p className="font-medium">Event Start</p>
                  <p className="text-sm text-gray-600">
                    {toReadableDateTimeStr(event.startDate)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-gray-500" />
                <div>
                  <p className="font-medium">Event End</p>
                  <p className="text-sm text-gray-600">
                    {toReadableDateTimeStr(event.endDate)}
                  </p>
                </div>
              </div>
              {event.hackUntil && (
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-blue-500" />
                  <div>
                    <p className="font-medium">Hacking Deadline</p>
                    <p className="text-sm text-gray-600">
                      {toReadableDateTimeStr(event.hackUntil)}
                    </p>
                  </div>
                </div>
              )}
              {event.voteUntil && (
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-yellow-500" />
                  <div>
                    <p className="font-medium">Voting Deadline</p>
                    <p className="text-sm text-gray-600">
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
              <div className="text-center py-8 text-gray-500">
                <Trophy className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No awards announced yet</p>
                <p className="text-sm">Awards will be announced soon!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {awards.map((award, index) => (
                  <div
                    key={award.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200"
                  >
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-r from-yellow-400 to-orange-400 flex items-center justify-center">
                        <span className="text-white font-bold text-sm">
                          {index + 1}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{award.name}</p>
                    </div>
                    <Trophy className="h-4 w-4 text-yellow-600" />
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
            <div className="text-center py-8 text-gray-500">
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
                    className={`border-2 transition-colors ${
                      isUserTeam
                        ? "border-blue-300 bg-blue-50"
                        : "hover:border-blue-200"
                    }`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-3">
                        {team.team_image_url ? (
                          <Avatar className="w-10 h-10">
                            <AvatarImage
                              src={team.team_image_url}
                              alt={team.team_image_alt || team.team_name}
                            />
                            <AvatarFallback>{team.team_name[0]}</AvatarFallback>
                          </Avatar>
                        ) : (
                          <Avatar className="w-10 h-10">
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
                                hasVotes={teamHasVotes}
                                isAdmin={isAdmin}
                                userLookup={userLookup}
                                onTeamDeleted={() => {
                                  // TanStack DB will automatically update via live queries
                                }}
                                onTeamUpdated={() => {
                                  // TanStack DB will automatically update via live queries
                                }}
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
                    <CardContent className="pt-0">
                      <div className="text-sm text-gray-600">
                        <div className="flex items-center gap-2 mb-1">
                          <Users className="h-4 w-4" />
                          <span className="font-medium">Team Members:</span>
                        </div>
                        {members.length > 0 && (
                          <div className="text-xs text-gray-500 pl-6">
                            {members.map((member, index) => (
                              <span key={member.userId}>
                                {getUserName(member.userId)}
                                {index < members.length - 1 ? ", " : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {team.project_description && (
                        <p className="text-sm text-gray-500 mt-2 line-clamp-2">
                          {team.project_description}
                        </p>
                      )}
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
