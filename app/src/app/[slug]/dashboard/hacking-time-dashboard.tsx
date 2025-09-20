"use client";

import Link from "next/link";
import { useLiveQuery } from "@tanstack/react-db";
import { eq } from "@tanstack/db";
import { Users, ExternalLink, Code, Clock } from "lucide-react";
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
import { EditTeamModal } from "./edit-team-modal";
import { TeamManagement } from "./team-management";

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

  const userTeamHasVotes = teamVotes && teamVotes.length > 0;

  // Get hacking deadline
  const hackingDeadline = event.hackUntil
    ? new Date(event.hackUntil)
    : new Date(event.endDate);

  return (
    <div className="space-y-8">
      {/* Countdown Timer */}
      <CountdownTimer
        targetDate={hackingDeadline}
        title="Hacking Time Remaining"
        subtitle="Make it count! Build something amazing."
      />

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        {userTeam ? (
          <TeamManagement
            hackId={userTeam.hackId}
            teamName={userTeam.teamName}
            user={user}
            hasVotes={userTeamHasVotes}
            onTeamDeleted={() => {
              // Trigger a refetch of the data
              window.location.reload();
            }}
            onTeamUpdated={() => {
              // Trigger a refetch of the data
              window.location.reload();
            }}
          />
        ) : (
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

      {/* User Team Status */}
      {userTeam ? (
        <Alert>
          <Code className="h-4 w-4" />
          <AlertDescription>
            <strong>You're hacking with team: {userTeam.teamName}</strong>
            <br />
            Good luck! Remember to submit your project before the deadline.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertDescription>
            <strong>You're not on a team yet!</strong>
            <br />
            Register a team now to participate in the hackathon.
          </AlertDescription>
        </Alert>
      )}

      {/* Hacking Tips */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-800 flex items-center gap-2">
            <Code className="h-5 w-5" />
            Hacking Tips
          </CardTitle>
        </CardHeader>
        <CardContent className="text-blue-700">
          <ul className="space-y-2 text-sm">
            <li>• Focus on building an MVP (Minimum Viable Product)</li>
            <li>• Document your project well for the judges</li>
            <li>• Test your demo before presenting</li>
            <li>• Don't forget to submit before the deadline!</li>
            <li>• Ask mentors for help if you get stuck</li>
          </ul>
        </CardContent>
      </Card>

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
            <div className="text-center py-8 text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No teams registered yet</p>
              <p className="text-sm">Be the first to register!</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {teams.map((team) => {
                const members =
                  teamMembers?.filter((m) => m.hackId === team.id) || [];
                const isUserTeam = members.some((m) => m.userId === user.id);

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
                              <>
                                <Badge variant="secondary" className="text-xs">
                                  Your Team
                                </Badge>
                                <EditTeamModal
                                  hackId={team.id}
                                  user={user}
                                  onTeamUpdated={() => {
                                    // Trigger a refetch of the data
                                    window.location.reload();
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
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <Users className="h-4 w-4" />
                        <span>
                          {members.length} member
                          {members.length !== 1 ? "s" : ""}
                        </span>
                        <Code className="h-4 w-4 ml-2" />
                        <span className="text-blue-600 font-medium">
                          Hacking
                        </span>
                      </div>
                      {team.project_description && (
                        <p className="text-sm text-gray-500 line-clamp-2">
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
