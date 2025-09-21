"use client";

import Link from "next/link";
import React from "react";
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
import { TeamCard } from "@/components/team-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  hacksCollection,
  hackVotesCollection,
  hackUsersCollection,
  hackImagesCollection,
  awardsCollection,
} from "@/lib/hackathons/collections";
import type { ExpandedEvent } from "@/lib/expanded-events";
import type { ClientUser } from "@/lib/client-user";

interface EndedDashboardProps {
  event: ExpandedEvent;
  user: ClientUser;
  isAdmin: boolean;
}

export function EndedDashboard({ event, user, isAdmin }: EndedDashboardProps) {
  // Get all teams for this event
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

  // Get all votes for this event - separate queries to avoid object concatenation issues
  const { data: allVotesRaw } = useLiveQuery((q) =>
    q.from({ vote: hackVotesCollection }),
  );

  const { data: allHacks } = useLiveQuery((q) =>
    q
      .from({ hack: hacksCollection })
      .where(({ hack }) => eq(hack.event_id, event.id)),
  );

  // Get awards for this event
  const { data: awards } = useLiveQuery((q) =>
    q
      .from({ award: awardsCollection })
      .where(({ award }) => eq(award.event_id, event.id))
      .select(({ award }) => ({
        id: award.id,
        name: award.name,
        event_id: award.event_id,
      })),
  );

  // Perform in-memory join to get votes with team details
  const allVotes = React.useMemo(() => {
    if (!allVotesRaw || !allHacks) return [];

    return allVotesRaw
      .map((vote) => {
        const hack = allHacks.find((h) => h.id === vote.hack_id);
        if (!hack) return null;

        return {
          voteId: `${vote.hack_id}-${vote.award_id}-${vote.user_id}`,
          hackId: vote.hack_id,
          awardId: vote.award_id,
          userId: vote.user_id,
          teamName: hack.team_name,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [allVotesRaw, allHacks]);

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

  // Calculate winners per award
  const awardWinners = React.useMemo(() => {
    if (!awards || !allVotes || !teams) return [];

    return awards.map((award) => {
      // Get votes for this specific award
      const awardVotes = allVotes.filter((vote) => vote.awardId === award.id);

      // Count votes per team for this award
      const voteCountsByTeam = awardVotes.reduce(
        (acc, vote) => {
          acc[vote.hackId] = (acc[vote.hackId] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      // Get teams with votes for this award and sort by vote count
      const teamsWithVotes = teams
        .map((team) => ({
          ...team,
          voteCount: voteCountsByTeam[team.id] || 0,
          members: teamMembers?.filter((m) => m.hackId === team.id) || [],
        }))
        .filter((team) => team.voteCount > 0) // Only include teams with votes
        .sort((a, b) => b.voteCount - a.voteCount);

      return {
        award,
        teams: teamsWithVotes,
        winner: teamsWithVotes[0] || null,
      };
    });
  }, [awards, allVotes, teams, teamMembers]);

  const userTeam = teamMembers?.find((member) => member.userId === user.id);
  const userVotes = allVotes?.filter((vote) => vote.userId === user.id) || [];

  return (
    <div className="space-y-8">
      {/* Header */}
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

      {/* Register on Luma */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5" />
            Event Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-2">
                View event details and connect with other participants
              </p>
              <Link
                href={`/r/${event.slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View on Luma
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

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

      {/* Award Winners */}
      <div className="space-y-6">
        {awardWinners.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5" />
                Award Winners
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-500">
                <Trophy className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No awards or votes yet</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          awardWinners.map((awardData) => (
            <Card key={awardData.award.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  {awardData.award.name}
                  {awardData.winner && (
                    <Badge
                      variant="secondary"
                      className="bg-yellow-100 text-yellow-800"
                    >
                      Winner: {awardData.winner.team_name}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {awardData.teams.length > 0
                    ? `${awardData.teams.length} team${awardData.teams.length !== 1 ? "s" : ""} received votes`
                    : "No votes for this award"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {awardData.teams.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">
                    <p>No teams received votes for this award</p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-[280px]">
                    {awardData.teams.slice(0, 3).map((team, index) => (
                      <TeamCard
                        key={team.id}
                        team={team}
                        members={team.members}
                        user={user}
                        isAdmin={isAdmin}
                        mode="ended"
                        voteCount={team.voteCount}
                        className={
                          index === 0
                            ? "border-yellow-300 bg-yellow-50"
                            : index === 1
                              ? "border-gray-300 bg-gray-50"
                              : "border-amber-300 bg-amber-50"
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
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
            All teams that participated in this hackathon
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!teams || teams.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No teams participated</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-[280px]">
              {teams.map((team) => {
                const members =
                  teamMembers?.filter((m) => m.hackId === team.id) || [];

                // Calculate total votes for this team across all awards
                const totalVotes =
                  allVotes?.filter((vote) => vote.hackId === team.id).length ||
                  0;

                return (
                  <TeamCard
                    key={team.id}
                    team={team}
                    members={members}
                    user={user}
                    isAdmin={isAdmin}
                    mode="ended"
                    voteCount={totalVotes}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
