"use client";

import Link from "next/link";
import React, { useState } from "react";
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
import { TeamCard } from "@/components/team-card";

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

  // Get all votes for this event - using separate queries to avoid join issues
  const { data: allVotesRaw } = useLiveQuery((q) =>
    q.from({ vote: hackVotesCollection }),
  );

  const { data: allHacks } = useLiveQuery((q) =>
    q
      .from({ hack: hacksCollection })
      .where(({ hack }) => eq(hack.event_id, event.id)),
  );

  // Add logging to debug the data structure
  React.useEffect(() => {
    console.log("=== VOTING DASHBOARD DEBUG ===");
    console.log("allVotesRaw:", allVotesRaw);
    if (allVotesRaw && allVotesRaw.length > 0) {
      console.log("First vote object:", allVotesRaw[0]);
      console.log("Vote keys:", Object.keys(allVotesRaw[0]));
      console.log("Vote values:", Object.values(allVotesRaw[0]));
      console.log(
        "vote.hack_id:",
        allVotesRaw[0].hack_id,
        "type:",
        typeof allVotesRaw[0].hack_id,
      );
      console.log(
        "vote.award_id:",
        allVotesRaw[0].award_id,
        "type:",
        typeof allVotesRaw[0].award_id,
      );
      console.log(
        "vote.user_id:",
        allVotesRaw[0].user_id,
        "type:",
        typeof allVotesRaw[0].user_id,
      );
    }
    console.log("allHacks:", allHacks);
    if (allHacks && allHacks.length > 0) {
      console.log("First hack object:", allHacks[0]);
      console.log("Hack keys:", Object.keys(allHacks[0]));
    }
    console.log("awards:", awards);
    if (awards && awards.length > 0) {
      console.log("First award object:", awards[0]);
      console.log("Award keys:", Object.keys(awards[0]));
    }
    console.log("==============================");
  }, [allVotesRaw, allHacks, awards]);

  // Process votes and join with hacks and awards in memory
  const allVotes = React.useMemo(() => {
    if (!allVotesRaw || !allHacks || !awards) return [];

    console.log("Processing votes in useMemo...");

    const hacksMap = new Map(allHacks.map((hack) => [hack.id, hack]));
    const awardsMap = new Map(awards.map((award) => [award.id, award]));

    return allVotesRaw
      .map((vote, index) => {
        console.log(`Processing vote ${index}:`, vote);

        try {
          const hackId = vote.hack_id;
          const awardId = vote.award_id;
          const userId = vote.user_id;

          console.log(
            `Vote ${index} - hackId:`,
            hackId,
            "type:",
            typeof hackId,
          );
          console.log(
            `Vote ${index} - awardId:`,
            awardId,
            "type:",
            typeof awardId,
          );
          console.log(
            `Vote ${index} - userId:`,
            userId,
            "type:",
            typeof userId,
          );

          const hack = hacksMap.get(hackId);
          const award = awardsMap.get(awardId);

          if (!hack || !award) {
            console.log(`Vote ${index} - Missing hack or award:`, {
              hack: !!hack,
              award: !!award,
            });
            return null;
          }

          const result = {
            voteId: `${hackId}-${awardId}-${userId}`,
            hackId,
            awardId,
            userId,
            teamName: hack.team_name,
            awardName: award.name,
          };

          console.log(`Vote ${index} - Result:`, result);
          return result;
        } catch (error) {
          console.error(`Error processing vote ${index}:`, error);
          console.error(`Vote ${index} data:`, vote);
          return null;
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [allVotesRaw, allHacks, awards]);

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
          <Button
            disabled
            variant="outline"
            size="lg"
            className="w-full h-12 text-sm"
          >
            <Users className="h-4 w-4 mr-2" />
            Your Team ({voteCount} votes)
          </Button>
        );
      case "voted":
        return (
          <Button
            disabled
            variant="default"
            size="lg"
            className="w-full h-12 text-sm bg-green-600 hover:bg-green-600"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Voted ({voteCount} votes)
          </Button>
        );
      case "loading":
        return (
          <Button disabled size="lg" className="w-full h-12 text-sm">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            Voting... ({voteCount} votes)
          </Button>
        );
      case "success":
        return (
          <Button
            disabled
            variant="default"
            size="lg"
            className="w-full h-12 text-sm bg-green-600 hover:bg-green-600"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Vote Submitted! ({voteCount + 1} votes)
          </Button>
        );
      case "error":
        return (
          <Button
            variant="destructive"
            size="lg"
            className="w-full h-12 text-sm"
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
            size="lg"
            className="w-full h-12 text-sm bg-primary hover:bg-primary/90"
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
    <div className="w-full max-w-none px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Countdown Timer */}
      <CountdownTimer
        targetDate={votingDeadline}
        title="Voting Time Remaining"
        subtitle="Vote for your favorite projects!"
        timerType="voting"
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
                <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
                  {teams.map((team) => {
                    const members =
                      teamMembers?.filter((m) => m.hackId === team.id) || [];
                    const voteKey = `${team.id}-${award.id}`;
                    const voteCount = voteCountsByTeamAndAward[voteKey] || 0;

                    return (
                      <TeamCard
                        key={team.id}
                        team={team}
                        members={members}
                        user={user}
                        isAdmin={isAdmin}
                        hasVotes={false} // Not used in voting mode
                        mode="voting"
                        voteButton={renderVoteButton(team, award)}
                        voteCount={voteCount}
                        onTeamUpdated={() => {
                          // TanStack DB will automatically update via live queries
                        }}
                      />
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
