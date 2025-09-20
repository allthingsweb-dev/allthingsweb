"use client";

import Link from "next/link";
import { useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { eq } from "@tanstack/db";
import {
  Users,
  ExternalLink,
  Vote,
  Heart,
  CheckCircle,
  AlertCircle,
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  hacksCollection,
  hackVotesCollection,
  hackUsersCollection,
  awardsCollection,
  hackImagesCollection,
} from "@/lib/hackathons/collections";
import { CountdownTimer } from "./countdown-timer";
import type { ExpandedEvent } from "@/lib/expanded-events";
import type { ClientUser } from "@/lib/client-user";
import { EditTeamModal } from "./edit-team-modal";

interface VotingTimeDashboardProps {
  event: ExpandedEvent;
  user: ClientUser;
  isAdmin: boolean;
}

export function VotingTimeDashboard({
  event,
  user,
  isAdmin,
}: VotingTimeDashboardProps) {
  const [votingStates, setVotingStates] = useState<
    Record<string, "idle" | "loading" | "success" | "error">
  >({});

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

  // Get all awards for this event
  const { data: awards } = useLiveQuery((q) =>
    q
      .from({ award: awardsCollection })
      .where(({ award }) => eq(award.event_id, event.id))
      .orderBy(({ award }) => award.created_at, "asc"),
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
      .join(
        { award: awardsCollection },
        ({ vote, award }) => eq(vote.award_id, award.id),
        "inner",
      )
      .where(({ hack }) => eq(hack.event_id, event.id))
      .select(({ vote, hack, award }) => ({
        voteId: `${vote.hack_id}-${vote.award_id}-${vote.user_id}`, // Composite key as voteId
        hackId: vote.hack_id,
        awardId: vote.award_id,
        userId: vote.user_id,
        teamName: hack.team_name,
        awardName: award.name,
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

  // Get user's votes
  const userVotes = allVotes?.filter((vote) => vote.userId === user.id) || [];
  const userTeam = teamMembers?.find((member) => member.userId === user.id);

  // Calculate vote counts per team per award
  const voteCountsByTeamAndAward =
    allVotes?.reduce(
      (acc, vote) => {
        const key = `${vote.hackId}-${vote.awardId}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ) || {};

  // Get user's votes by hack and award
  const userVotesByHackAndAward = userVotes.reduce(
    (acc, vote) => {
      const key = `${vote.hackId}-${vote.awardId}`;
      acc[key] = vote;
      return acc;
    },
    {} as Record<string, any>,
  );

  // Get voting deadline
  const votingDeadline = event.voteUntil
    ? new Date(event.voteUntil)
    : new Date(event.endDate);

  const handleVote = async (
    teamId: string,
    awardId: string,
    teamName: string,
    awardName: string,
  ) => {
    const voteKey = `${teamId}-${awardId}`;

    // Check if user already voted for this team for this award
    if (userVotesByHackAndAward[voteKey]) {
      toast.error(`You've already voted for ${teamName} for ${awardName}!`);
      return;
    }

    // Check if user is trying to vote for their own team
    if (userTeam?.hackId === teamId) {
      toast.error("You can't vote for your own team!");
      return;
    }

    setVotingStates((prev) => ({ ...prev, [voteKey]: "loading" }));

    try {
      // Optimistic update - add vote to collection
      hackVotesCollection.insert({
        hack_id: teamId,
        award_id: awardId,
        user_id: user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Make API call to persist vote
      const response = await fetch("/api/v1/hack-votes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hackId: teamId,
          awardId: awardId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit vote");
      }

      setVotingStates((prev) => ({ ...prev, [voteKey]: "success" }));
      toast.success(`Voted for ${teamName} for ${awardName}!`);

      // Reset state after 2 seconds
      setTimeout(() => {
        setVotingStates((prev) => ({ ...prev, [voteKey]: "idle" }));
      }, 2000);
    } catch (error) {
      console.error("Error voting:", error);
      setVotingStates((prev) => ({ ...prev, [voteKey]: "error" }));
      toast.error("Failed to submit vote. Please try again.");

      // Reset state after 2 seconds
      setTimeout(() => {
        setVotingStates((prev) => ({ ...prev, [voteKey]: "idle" }));
      }, 2000);
    }
  };

  const getVoteButtonState = (teamId: string, awardId: string) => {
    const voteKey = `${teamId}-${awardId}`;
    const hasVoted = !!userVotesByHackAndAward[voteKey];
    const isOwnTeam = userTeam?.hackId === teamId;
    const votingState = votingStates[voteKey] || "idle";

    if (isOwnTeam) return "own-team";
    if (hasVoted) return "voted";
    return votingState;
  };

  const renderVoteButton = (team: any, award: any) => {
    const voteKey = `${team.id}-${award.id}`;
    const buttonState = getVoteButtonState(team.id, award.id);
    const voteCount = voteCountsByTeamAndAward[voteKey] || 0;

    switch (buttonState) {
      case "own-team":
        return (
          <Button disabled variant="outline" size="sm" className="w-full">
            <Users className="h-4 w-4 mr-2" />
            Your Team ({voteCount} votes)
          </Button>
        );
      case "voted":
        return (
          <Button
            disabled
            variant="default"
            size="sm"
            className="w-full bg-green-600 hover:bg-green-600"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Voted ({voteCount} votes)
          </Button>
        );
      case "loading":
        return (
          <Button disabled size="sm" className="w-full">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            Voting... ({voteCount} votes)
          </Button>
        );
      case "success":
        return (
          <Button
            disabled
            variant="default"
            size="sm"
            className="w-full bg-green-600 hover:bg-green-600"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Vote Submitted! ({voteCount + 1} votes)
          </Button>
        );
      case "error":
        return (
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() =>
              handleVote(team.id, award.id, team.team_name, award.name)
            }
          >
            <AlertCircle className="h-4 w-4 mr-2" />
            Retry Vote ({voteCount} votes)
          </Button>
        );
      default:
        return (
          <Button
            size="sm"
            className="w-full"
            onClick={() =>
              handleVote(team.id, award.id, team.team_name, award.name)
            }
          >
            <Heart className="h-4 w-4 mr-2" />
            Vote ({voteCount} votes)
          </Button>
        );
    }
  };

  return (
    <div className="space-y-8">
      {/* Countdown Timer */}
      <CountdownTimer
        targetDate={votingDeadline}
        title="Voting Time Remaining"
        subtitle="Vote for your favorite projects!"
      />

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

      {/* Voting Status */}
      <Alert>
        <Vote className="h-4 w-4" />
        <AlertDescription>
          <strong>Voting is now open!</strong>
          <br />
          You've cast {userVotes.length} vote{userVotes.length !== 1 ? "s" : ""}{" "}
          across {awards?.length || 0} award{awards?.length !== 1 ? "s" : ""}.
          {userTeam && ` You're on team: ${userTeam.teamName}`}
        </AlertDescription>
      </Alert>

      {/* Voting Instructions */}
      <Card className="border-yellow-200 bg-yellow-50">
        <CardHeader>
          <CardTitle className="text-yellow-800 flex items-center gap-2">
            <Vote className="h-5 w-5" />
            Voting Instructions
          </CardTitle>
        </CardHeader>
        <CardContent className="text-yellow-700">
          <ul className="space-y-2 text-sm">
            <li>• You can vote for multiple teams across different awards</li>
            <li>• You can vote once per team per award</li>
            <li>• You cannot vote for your own team</li>
            <li>• Each vote counts equally within its award category</li>
            <li>
              • Vote for projects you find most impressive in each category
            </li>
            <li>• Voting closes at the deadline above</li>
          </ul>
        </CardContent>
      </Card>

      {/* Awards and Voting */}
      {!awards || awards.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>No awards have been set up for this event yet.</strong>
            <br />
            Please wait for the organizers to configure the awards.
          </AlertDescription>
        </Alert>
      ) : (
        awards.map((award) => (
          <Card key={award.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Vote className="h-5 w-5" />
                {award.name}
                <Badge variant="secondary">{teams?.length || 0} teams</Badge>
              </CardTitle>
              <CardDescription>
                Vote for your favorite team in this category
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!teams || teams.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No teams to vote for</p>
                </div>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {teams.map((team) => {
                    const members =
                      teamMembers?.filter((m) => m.hackId === team.id) || [];
                    const isUserTeam = members.some(
                      (m) => m.userId === user.id,
                    );
                    const voteKey = `${team.id}-${award.id}`;
                    const voteCount = voteCountsByTeamAndAward[voteKey] || 0;

                    return (
                      <Card
                        key={team.id}
                        className={`border-2 transition-colors ${
                          isUserTeam
                            ? "border-blue-300 bg-blue-50"
                            : "hover:border-gray-300"
                        }`}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-3">
                            {team.team_image_url ? (
                              <Avatar className="w-12 h-12">
                                <AvatarImage
                                  src={team.team_image_url}
                                  alt={team.team_image_alt || team.team_name}
                                />
                                <AvatarFallback>
                                  {team.team_name[0]}
                                </AvatarFallback>
                              </Avatar>
                            ) : (
                              <Avatar className="w-12 h-12">
                                <AvatarFallback>
                                  {team.team_name[0]}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <div className="flex-1 min-w-0">
                              <CardTitle className="text-base truncate flex items-center gap-2">
                                {team.team_name}
                                {isUserTeam && (
                                  <>
                                    <Badge
                                      variant="secondary"
                                      className="text-xs"
                                    >
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
                            <span>
                              {members.length} member
                              {members.length !== 1 ? "s" : ""}
                            </span>
                            <span className="text-gray-400">•</span>
                            <span className="text-blue-600 font-medium">
                              {voteCount} vote{voteCount !== 1 ? "s" : ""}
                            </span>
                          </div>
                          {team.project_description && (
                            <p className="text-sm text-gray-500 line-clamp-3">
                              {team.project_description}
                            </p>
                          )}
                          <div className="pt-2">
                            {renderVoteButton(team, award)}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
