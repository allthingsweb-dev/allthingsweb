"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Edit, Trash2, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { EditTeamModal } from "./edit-team-modal";
import type { ClientUser } from "@/lib/client-user";

interface TeamManagementProps {
  hackId: string;
  teamName: string;
  user: ClientUser;
  hasVotes?: boolean;
  isAdmin?: boolean;
  onTeamDeleted?: () => void;
  onTeamUpdated?: () => void;
  userLookup?: Array<{ id: string; name: string | null }>;
  // Mode-specific props
  mode?: "default" | "voting" | "ended";
  voteButton?: React.ReactNode;
}

export function TeamManagement({
  hackId,
  teamName,
  user,
  hasVotes = false,
  isAdmin = false,
  onTeamDeleted,
  onTeamUpdated,
  userLookup = [],
  mode = "default",
  voteButton,
}: TeamManagementProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteTeam = async () => {
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/v1/teams/${hackId}/delete`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success("Team deleted successfully");
        setShowDeleteDialog(false);
        if (onTeamDeleted) {
          onTeamDeleted();
        }
        // TanStack DB will automatically update via live queries
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || "Failed to delete team");
      }
    } catch (error) {
      console.error("Error deleting team:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {mode === "voting" ? (
        // In voting mode, render the vote button
        voteButton
      ) : mode === "ended" ? null : ( // In ended mode, don't render any management controls
        // In default mode, render the dropdown menu
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 ml-auto">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Open team menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-48">
            <EditTeamModal
              hackId={hackId}
              user={user}
              isAdmin={isAdmin}
              onTeamUpdated={onTeamUpdated ? () => onTeamUpdated() : undefined}
              userLookup={userLookup}
              trigger={
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  className="cursor-pointer"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Team
                </DropdownMenuItem>
              }
            />

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setShowDeleteDialog(true)}
              disabled={hasVotes && !isAdmin}
              className="cursor-pointer text-red-600 focus:text-red-600 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Team
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Team</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the team "{teamName}"? This action
              cannot be undone and will:
              <br />
              <br />
              • Remove all team members
              <br />
              • Delete the team image (if any)
              <br />
              • Permanently delete all team data
              <br />
              <br />
              {hasVotes && !isAdmin ? (
                <span className="text-red-600 font-medium">
                  ⚠️ This team cannot be deleted because votes have already been
                  cast for it.
                </span>
              ) : hasVotes && isAdmin ? (
                <span className="text-orange-600 font-medium">
                  ⚠️ This team has votes but can be deleted with admin
                  privileges. This will also remove all associated votes.
                </span>
              ) : (
                "This action is only available before voting begins."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTeam}
              disabled={isDeleting || (hasVotes && !isAdmin)}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Team
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
