"use client";

/**
 * Components Preview - A Storybook-like interface for viewing UI components
 *
 * This page provides a comprehensive preview of all UI components in their various
 * states and variants. It's designed for:
 * - Design system documentation
 * - Visual testing of component states
 * - Dark/light mode comparison
 * - Component development and debugging
 *
 * Admin-only access ensures this is used only for development/testing purposes.
 */

import { useState } from "react";
import { ComponentsNavbar } from "./components-navbar";
import { TeamCard } from "@/components/team-card";
import { TeamManagement } from "@/app/[slug]/dashboard/team-management";
import { TeamMemberManagement } from "@/components/team-member-management";
import { RegisterTeamModal } from "@/app/[slug]/dashboard/register-team-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, Star, Zap, Clock, Trophy } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ServerUser } from "@stackframe/stack";
import type { ClientUser } from "@/lib/client-user";
import { toClientUser } from "@/lib/client-user";

interface ComponentsPreviewProps {
  user: ServerUser;
}

// Mock data for component examples
const mockUser: ClientUser = {
  id: "user-1",
  displayName: "John Doe",
  primaryEmail: "john@example.com",
  profileImageUrl: null,
};

const mockUsers = [
  { id: "user-1", displayName: "John Doe" },
  { id: "user-2", displayName: "Jane Smith" },
  { id: "user-3", displayName: "Bob Wilson" },
  { id: "user-4", displayName: "Alice Brown" },
];

const mockTeams = [
  {
    id: "team-1",
    team_name: "Team Alpha",
    project_name: "AI Chat Assistant",
    project_description:
      "An intelligent chatbot that helps users with customer support queries using advanced NLP and machine learning.",
    project_link: "https://github.com/team-alpha/ai-chat",
    team_image_url: null,
    team_image_alt: null,
  },
  {
    id: "team-2",
    team_name: "Code Ninjas",
    project_name: "Smart Task Manager",
    project_description:
      "A productivity app with AI-powered task prioritization and smart scheduling features.",
    project_link: "https://github.com/code-ninjas/task-manager",
    team_image_url: null,
    team_image_alt: null,
  },
  {
    id: "team-3",
    team_name: "Innovation Labs",
    project_name: null,
    project_description: null,
    project_link: null,
    team_image_url: null,
    team_image_alt: null,
  },
];

const mockMembers = [
  [
    { hackId: "team-1", userId: "user-1" },
    { hackId: "team-1", userId: "user-2" },
  ],
  [
    { hackId: "team-2", userId: "user-3" },
    { hackId: "team-2", userId: "user-4" },
    { hackId: "team-2", userId: "user-1" },
  ],
  [{ hackId: "team-3", userId: "user-2" }],
];

const componentRegistry = {
  "team-card": {
    name: "Team Card",
    description: "Enhanced team cards with improved contrast and layout",
  },
  "team-management": {
    name: "Team Management",
    description: "Dropdown component for team edit/delete actions",
  },
  "team-member-management": {
    name: "Team Member Management",
    description: "Component for adding/removing team members with user search",
  },
  badges: {
    name: "Badges",
    description: "Various badge variants and states",
  },
  buttons: {
    name: "Buttons",
    description: "Button variants, sizes, and states",
  },
  avatars: {
    name: "Avatars",
    description: "Avatar components with fallbacks and different sizes",
  },
};

export function ComponentsPreview({ user }: ComponentsPreviewProps) {
  const [selectedComponent, setSelectedComponent] =
    useState<string>("team-card");
  const clientUser = toClientUser(user);

  const renderTeamCardVariants = () => {
    return (
      <div className="space-y-8">
        {/* Default State */}
        <div className="space-y-4">
          <div className="border-l-4 border-blue-500 pl-4">
            <h3 className="text-lg font-semibold">Default State</h3>
            <p className="text-sm text-muted-foreground">
              Regular team cards with different content states
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mockTeams.map((team, index) => (
              <TeamCard
                key={team.id}
                team={team}
                members={mockMembers[index]}
                user={clientUser}
                isAdmin={false}
                hasVotes={false}
                userLookup={mockUsers}
                mode="default"
              />
            ))}
          </div>
        </div>

        {/* User Team State */}
        <div className="space-y-4">
          <div className="border-l-4 border-green-500 pl-4">
            <h3 className="text-lg font-semibold">User Team State</h3>
            <p className="text-sm text-muted-foreground">
              How cards look when user is part of the team
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TeamCard
              team={mockTeams[0]}
              members={mockMembers[0]}
              user={clientUser}
              isAdmin={false}
              hasVotes={false}
              userLookup={mockUsers}
              mode="default"
            />
            <TeamCard
              team={mockTeams[1]}
              members={mockMembers[1]}
              user={clientUser}
              isAdmin={false}
              hasVotes={false}
              userLookup={mockUsers}
              mode="default"
            />
          </div>
        </div>

        {/* Voting Mode */}
        <div className="space-y-4">
          <div className="border-l-4 border-purple-500 pl-4">
            <h3 className="text-lg font-semibold">Voting Mode</h3>
            <p className="text-sm text-muted-foreground">
              Cards during voting period with vote counts and buttons
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TeamCard
              team={mockTeams[0]}
              members={mockMembers[0]}
              user={{ ...clientUser, id: "other-user" }}
              isAdmin={false}
              hasVotes={false}
              userLookup={mockUsers}
              mode="voting"
              voteCount={12}
              voteButton={
                <Button className="w-full" variant="outline">
                  Vote for this team
                </Button>
              }
            />
            <TeamCard
              team={mockTeams[1]}
              members={mockMembers[1]}
              user={{ ...clientUser, id: "other-user" }}
              isAdmin={false}
              hasVotes={false}
              userLookup={mockUsers}
              mode="voting"
              voteCount={8}
              voteButton={
                <Button className="w-full" disabled>
                  Already voted
                </Button>
              }
            />
          </div>
        </div>

        {/* Ended Mode */}
        <div className="space-y-4">
          <div className="border-l-4 border-yellow-500 pl-4">
            <h3 className="text-lg font-semibold">Ended Mode</h3>
            <p className="text-sm text-muted-foreground">
              Final results view with vote counts
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TeamCard
              team={mockTeams[0]}
              members={mockMembers[0]}
              user={{ ...clientUser, id: "other-user" }}
              isAdmin={false}
              hasVotes={false}
              userLookup={mockUsers}
              mode="ended"
              voteCount={15}
              className="border-yellow-300 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-950"
            />
            <TeamCard
              team={mockTeams[1]}
              members={mockMembers[1]}
              user={{ ...clientUser, id: "other-user" }}
              isAdmin={false}
              hasVotes={false}
              userLookup={mockUsers}
              mode="ended"
              voteCount={10}
              className="border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-950"
            />
          </div>
        </div>

        {/* Admin Mode */}
        <div className="space-y-4">
          <div className="border-l-4 border-red-500 pl-4">
            <h3 className="text-lg font-semibold">Admin Mode</h3>
            <p className="text-sm text-muted-foreground">
              Cards with admin management capabilities
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TeamCard
              team={mockTeams[0]}
              members={mockMembers[0]}
              user={{ ...clientUser, id: "other-user" }}
              isAdmin={true}
              hasVotes={true}
              userLookup={mockUsers}
              mode="default"
            />
            <TeamCard
              team={mockTeams[2]}
              members={mockMembers[2]}
              user={{ ...clientUser, id: "other-user" }}
              isAdmin={true}
              hasVotes={false}
              userLookup={mockUsers}
              mode="default"
            />
          </div>
        </div>

        {/* Edge Cases */}
        <div className="space-y-4">
          <div className="border-l-4 border-gray-500 pl-4">
            <h3 className="text-lg font-semibold">Edge Cases</h3>
            <p className="text-sm text-muted-foreground">
              Empty states and minimal content
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TeamCard
              team={{
                id: "empty-team",
                team_name: "Empty Team",
                project_name: null,
                project_description: null,
                project_link: null,
                team_image_url: null,
                team_image_alt: null,
              }}
              members={[]}
              user={{ ...clientUser, id: "other-user" }}
              isAdmin={false}
              hasVotes={false}
              userLookup={mockUsers}
              mode="default"
            />
            <TeamCard
              team={{
                id: "solo-team",
                team_name:
                  "Solo Project with Very Long Name That Should Truncate",
                project_name:
                  "A project with an extremely long name that should be truncated in the UI",
                project_description:
                  "This is a very long description that should demonstrate how the component handles long text content and shows the line clamping behavior working properly.",
                project_link:
                  "https://github.com/very-long-username/extremely-long-repository-name-that-goes-on-forever",
                team_image_url: null,
                team_image_alt: null,
              }}
              members={[{ hackId: "solo-team", userId: "user-1" }]}
              user={clientUser}
              isAdmin={false}
              hasVotes={false}
              userLookup={mockUsers}
              mode="default"
            />
          </div>
        </div>
      </div>
    );
  };

  const renderTeamManagementVariants = () => {
    return (
      <div className="space-y-8">
        <div className="space-y-4">
          <div className="border-l-4 border-blue-500 pl-4">
            <h3 className="text-lg font-semibold">Team Management States</h3>
            <p className="text-sm text-muted-foreground">
              Dropdown component for team actions
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Regular User Team
                  <TeamManagement
                    hackId="demo-team"
                    teamName="Demo Team"
                    user={clientUser}
                    hasVotes={false}
                    isAdmin={false}
                  />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  User can edit/delete their own team
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Admin Access
                  <TeamManagement
                    hackId="demo-team-2"
                    teamName="Other Team"
                    user={{ ...clientUser, id: "admin-user" }}
                    hasVotes={false}
                    isAdmin={true}
                  />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Admin can manage any team
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  With Votes (Protected)
                  <TeamManagement
                    hackId="demo-team-3"
                    teamName="Voting Team"
                    user={clientUser}
                    hasVotes={true}
                    isAdmin={false}
                  />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Team with votes - deletion restricted
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  };

  const renderTeamMemberManagementVariants = () => {
    return (
      <div className="space-y-8">
        <div className="space-y-4">
          <div className="border-l-4 border-green-500 pl-4">
            <h3 className="text-lg font-semibold">Team Member Management</h3>
            <p className="text-sm text-muted-foreground">
              Component for managing team members
            </p>
          </div>
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Create Mode</CardTitle>
                <CardDescription>When creating a new team</CardDescription>
              </CardHeader>
              <CardContent>
                <TeamMemberManagement
                  user={clientUser}
                  selectedUsers={[mockUsers[1], mockUsers[2]].map((u) => ({
                    ...u,
                    primaryEmail: null,
                    profileImageUrl: null,
                  }))}
                  onUsersChange={() => {}}
                  mode="create"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Edit Mode</CardTitle>
                <CardDescription>When editing existing team</CardDescription>
              </CardHeader>
              <CardContent>
                <TeamMemberManagement
                  user={clientUser}
                  selectedUsers={[mockUsers[0]].map((u) => ({
                    ...u,
                    primaryEmail: null,
                    profileImageUrl: null,
                  }))}
                  onUsersChange={() => {}}
                  hackId="demo-team"
                  mode="edit"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  };

  const renderBadgeVariants = () => {
    return (
      <div className="space-y-8">
        <div className="space-y-4">
          <div className="border-l-4 border-purple-500 pl-4">
            <h3 className="text-lg font-semibold">Badge Variants</h3>
            <p className="text-sm text-muted-foreground">
              Different badge styles and colors
            </p>
          </div>
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Default Badges</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="destructive">Destructive</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Custom Styled Badges</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Badge className="bg-blue-500 hover:bg-blue-600">
                  Your Team
                </Badge>
                <Badge className="bg-green-500 hover:bg-green-600">
                  Winner
                </Badge>
                <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">
                  Popular
                </Badge>
                <Badge
                  variant="outline"
                  className="border-purple-500 text-purple-700 dark:text-purple-400"
                >
                  <Trophy className="h-3 w-3 mr-1" />
                  Award Winner
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Vote Count Badges</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Badge
                  variant="outline"
                  className="text-primary border-primary/30"
                >
                  12 votes
                </Badge>
                <Badge
                  variant="outline"
                  className="text-primary border-primary/30"
                >
                  1 vote
                </Badge>
                <Badge
                  variant="outline"
                  className="text-primary border-primary/30"
                >
                  0 votes
                </Badge>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  };

  const renderButtonVariants = () => {
    return (
      <div className="space-y-8">
        <div className="space-y-4">
          <div className="border-l-4 border-orange-500 pl-4">
            <h3 className="text-lg font-semibold">Button Variants</h3>
            <p className="text-sm text-muted-foreground">
              Different button styles and states
            </p>
          </div>
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Variants</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button>Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sizes</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3 items-center">
                <Button size="sm">Small</Button>
                <Button>Default</Button>
                <Button size="lg">Large</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>States</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button disabled>Disabled</Button>
                <Button>
                  <Clock className="h-4 w-4 mr-2" />
                  With Icon
                </Button>
                <Button className="w-full max-w-xs">Full Width</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Action Buttons</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button className="bg-blue-600 hover:bg-blue-700">
                  Vote for this team
                </Button>
                <Button variant="outline" disabled>
                  Already voted
                </Button>
                <Button
                  variant="outline"
                  className="border-primary/20 bg-primary/5 hover:bg-primary/10"
                >
                  <Star className="h-4 w-4 mr-2" />
                  View Project
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  };

  const renderAvatarVariants = () => {
    return (
      <div className="space-y-8">
        <div className="space-y-4">
          <div className="border-l-4 border-red-500 pl-4">
            <h3 className="text-lg font-semibold">Avatar Variants</h3>
            <p className="text-sm text-muted-foreground">
              Avatar components with different sizes and states
            </p>
          </div>
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Sizes</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="text-xs">S</AvatarFallback>
                </Avatar>
                <Avatar className="w-10 h-10">
                  <AvatarFallback className="text-sm">M</AvatarFallback>
                </Avatar>
                <Avatar className="w-12 h-12">
                  <AvatarFallback>L</AvatarFallback>
                </Avatar>
                <Avatar className="w-16 h-16">
                  <AvatarFallback className="text-lg">XL</AvatarFallback>
                </Avatar>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>With Rings</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <Avatar className="w-12 h-12 ring-2 ring-border">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    T
                  </AvatarFallback>
                </Avatar>
                <Avatar className="w-12 h-12 ring-2 ring-blue-200">
                  <AvatarFallback className="bg-blue-100 text-blue-600">
                    A
                  </AvatarFallback>
                </Avatar>
                <Avatar className="w-12 h-12 ring-2 ring-green-200">
                  <AvatarFallback className="bg-green-100 text-green-600">
                    W
                  </AvatarFallback>
                </Avatar>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Team Avatars</CardTitle>
                <CardDescription>
                  How avatars appear in team cards
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <Avatar className="w-14 h-14 ring-2 ring-border">
                  <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
                    C
                  </AvatarFallback>
                </Avatar>
                <Avatar className="w-14 h-14 ring-2 ring-border">
                  <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
                    T
                  </AvatarFallback>
                </Avatar>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  };

  const renderComponentVariants = () => {
    switch (selectedComponent) {
      case "team-card":
        return renderTeamCardVariants();
      case "team-management":
        return renderTeamManagementVariants();
      case "team-member-management":
        return renderTeamMemberManagementVariants();
      case "badges":
        return renderBadgeVariants();
      case "buttons":
        return renderButtonVariants();
      case "avatars":
        return renderAvatarVariants();
      default:
        return <div>Component not found</div>;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <ComponentsNavbar />

      <div className="container py-6">
        <div className="mb-6">
          <Card>
            <CardHeader>
              <CardTitle>Component Selector</CardTitle>
              <CardDescription>
                Choose a component to view all its variants and states
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-4">
                <Select
                  value={selectedComponent}
                  onValueChange={setSelectedComponent}
                >
                  <SelectTrigger className="w-[300px]">
                    <SelectValue placeholder="Select a component" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(componentRegistry).map(([key, comp]) => (
                      <SelectItem key={key} value={key}>
                        {comp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">
                    {
                      componentRegistry[
                        selectedComponent as keyof typeof componentRegistry
                      ]?.description
                    }
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">{renderComponentVariants()}</div>
      </div>
    </div>
  );
}
