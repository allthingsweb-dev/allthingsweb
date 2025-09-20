"use client";

import Link from "next/link";
import { useLiveQuery } from "@tanstack/react-db";
import { eq } from "@tanstack/db";
import { Users, ExternalLink, Trophy, Medal, Award, Star } from "lucide-react";
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
  hackVotesCollection,
  hackUsersCollection,
  hackImagesCollection,
} from "@/lib/hackathons/collections";
import type { ExpandedEvent } from "@/lib/expanded-events";
import type { ClientUser } from "@/lib/client-user";
import { EditTeamModal } from "./edit-team-modal";

interface EndedDashboardProps {
  event: ExpandedEvent;
  user: ClientUser;
  isAdmin: boolean;
}

export function EndedDashboard({ event, user, isAdmin }: EndedDashboardProps) {
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

  // Get all votes for this event
  const { data: allVotes } = useLiveQuery((q) =>
    q
      .from({ vote: hackVotesCollection })
      .join(
        { hack: hacksCollection },
        ({ vote, hack }) => eq(vote.hack_id, hack.id),
        "inner",
      )
      .where(({ hack }) => eq(hack.event_id, event.id))
      .select(({ vote, hack }) => ({
        voteId: `${vote.hack_id}-${vote.award_id}-${vote.user_id}`, // Composite key as voteId
        hackId: vote.hack_id,
        awardId: vote.award_id,
        userId: vote.user_id,
        teamName: hack.team_name,
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

  // Calculate vote counts and rankings
  const voteCountsByTeam =
    allVotes?.reduce(
      (acc, vote) => {
        acc[vote.hackId] = (acc[vote.hackId] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ) || {};

  // Sort teams by vote count for rankings
  const rankedTeams =
    teams
      ?.map((team) => ({
        ...team,
        voteCount: voteCountsByTeam[team.id] || 0,
        members: teamMembers?.filter((m) => m.hackId === team.id) || [],
      }))
      .sort((a, b) => b.voteCount - a.voteCount) || [];

  const userTeam = teamMembers?.find((member) => member.userId === user.id);
  const userVotes = allVotes?.filter((vote) => vote.userId === user.id) || [];

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0:
        return <Trophy className="h-5 w-5 text-yellow-500" />;
      case 1:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 2:
        return <Award className="h-5 w-5 text-amber-600" />;
      default:
        return <Star className="h-5 w-5 text-gray-300" />;
    }
  };

  const getRankBadgeColor = (index: number) => {
    switch (index) {
      case 0:
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case 1:
        return "bg-gray-100 text-gray-800 border-gray-200";
      case 2:
        return "bg-amber-100 text-amber-800 border-amber-200";
      default:
        return "bg-gray-50 text-gray-600 border-gray-200";
    }
  };

  return (
    <div className="space-y-8">
      {/* Event Ended Header */}
      <div className="text-center">
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl p-8">
          <Trophy className="h-16 w-16 mx-auto mb-4" />
          <h2 className="text-3xl font-bold mb-2">Hackathon Complete!</h2>
          <p className="text-lg opacity-90">
            Thanks for participating in {event.name}
          </p>
          <div className="mt-4 text-sm opacity-75">
            Total Teams: {teams?.length || 0} • Total Votes:{" "}
            {allVotes?.length || 0}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-center">
        {event.lumaEventUrl && (
          <Button asChild variant="outline" size="lg">
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

      {/* User Summary */}
      <Alert>
        <Star className="h-4 w-4" />
        <AlertDescription>
          <strong>Your Hackathon Summary:</strong>
          <br />
          {userTeam ? `Team: ${userTeam.teamName}` : "You didn't join a team"} •
          Votes cast: {userVotes.length}
        </AlertDescription>
      </Alert>

      {/* Final Rankings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Final Rankings
            <Badge variant="secondary">{rankedTeams.length}</Badge>
          </CardTitle>
          <CardDescription>Teams ranked by community votes</CardDescription>
        </CardHeader>
        <CardContent>
          {rankedTeams.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Trophy className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No teams participated</p>
            </div>
          ) : (
            <div className="space-y-4">
              {rankedTeams.map((team, index) => {
                const isUserTeam = team.members.some(
                  (m) => m.userId === user.id,
                );
                const hasUserVote = userVotes.some(
                  (vote) => vote.hackId === team.id,
                );

                return (
                  <Card
                    key={team.id}
                    className={`border-2 transition-colors ${
                      index === 0
                        ? "border-yellow-300 bg-yellow-50"
                        : index === 1
                          ? "border-gray-300 bg-gray-50"
                          : index === 2
                            ? "border-amber-300 bg-amber-50"
                            : isUserTeam
                              ? "border-blue-300 bg-blue-50"
                              : "border-gray-200"
                    }`}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-center gap-4">
                        {/* Rank */}
                        <div className="flex flex-col items-center">
                          {getRankIcon(index)}
                          <Badge
                            variant="outline"
                            className={`mt-1 text-xs ${getRankBadgeColor(index)}`}
                          >
                            #{index + 1}
                          </Badge>
                        </div>

                        {/* Team Avatar */}
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

                        {/* Team Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-lg font-semibold truncate">
                              {team.team_name}
                            </h3>
                            {isUserTeam && (
                              <>
                                <Badge variant="secondary" className="text-xs">
                                  Your Team
                                </Badge>
                                <EditTeamModal
                                  hackId={team.id}
                                  user={user}
                                  onTeamUpdated={() => {
                                    // TanStack DB will automatically update via live queries
                                  }}
                                />
                              </>
                            )}
                            {hasUserVote && (
                              <Badge
                                variant="outline"
                                className="text-xs text-blue-600 border-blue-200"
                              >
                                You Voted
                              </Badge>
                            )}
                          </div>
                          {team.project_name && (
                            <p className="text-sm text-gray-600 mb-1">
                              {team.project_name}
                            </p>
                          )}
                          <div className="flex items-center gap-4 text-sm text-gray-500">
                            <span className="flex items-center gap-1">
                              <Users className="h-4 w-4" />
                              {team.members.length} member
                              {team.members.length !== 1 ? "s" : ""}
                            </span>
                            <span className="flex items-center gap-1">
                              <Star className="h-4 w-4" />
                              {team.voteCount} vote
                              {team.voteCount !== 1 ? "s" : ""}
                            </span>
                          </div>
                          {team.project_description && (
                            <p className="text-sm text-gray-500 mt-2 line-clamp-2">
                              {team.project_description}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Thank You Message */}
      <Card className="border-green-200 bg-green-50">
        <CardHeader>
          <CardTitle className="text-green-800 flex items-center gap-2">
            <Star className="h-5 w-5" />
            Thank You for Participating!
          </CardTitle>
        </CardHeader>
        <CardContent className="text-green-700">
          <p className="mb-3">
            We hope you had an amazing time at {event.name}! Your creativity and
            hard work made this hackathon a huge success.
          </p>
          <ul className="space-y-1 text-sm">
            <li>• Connect with fellow participants</li>
            <li>• Share your projects on social media</li>
            <li>• Join our community for future events</li>
            <li>• Keep building amazing things!</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
