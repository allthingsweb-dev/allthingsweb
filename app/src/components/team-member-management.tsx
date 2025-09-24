"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandInput,
  CommandEmpty,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, X, UserMinus } from "lucide-react";
import { toast } from "sonner";
import type { ClientUser } from "@/lib/client-user";
import { useUsers } from "@/hooks/use-users";

interface TeamMemberManagementProps {
  user: ClientUser;
  selectedUsers: ClientUser[];
  onUsersChange: (users: ClientUser[]) => void;
  disabled?: boolean;
  hackId?: string; // For edit mode - to add/remove members from existing team
  showCurrentUser?: boolean; // Whether to show current user in the list
  mode?: "create" | "edit"; // Create or edit mode
}

export function TeamMemberManagement({
  user,
  selectedUsers,
  onUsersChange,
  disabled = false,
  hackId,
  showCurrentUser = true,
  mode = "create",
}: TeamMemberManagementProps) {
  const { users: allUsers } = useUsers();
  const [openSearch, setOpenSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const selectedIds = useMemo(
    () => new Set(selectedUsers.map((u) => u.id)),
    [selectedUsers],
  );

  // Filter users based on search query
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return [];

    return allUsers
      .filter((u) => {
        // Exclude already selected users and current user (if not showing current user)
        if (selectedIds.has(u.id) || (!showCurrentUser && u.id === user.id)) {
          return false;
        }

        const query = searchQuery.toLowerCase();
        return (
          u.displayName?.toLowerCase().includes(query) ||
          u.primaryEmail?.toLowerCase().includes(query)
        );
      })
      .slice(0, 10); // Limit to 10 results
  }, [allUsers, searchQuery, selectedIds, showCurrentUser, user.id]);

  const handleAddUser = async (userToAdd: ClientUser) => {
    if (selectedIds.has(userToAdd.id)) return;

    setIsAddingMember(true);

    try {
      if (mode === "edit" && hackId) {
        // For edit mode, add user to the team via API
        const response = await fetch("/api/v1/hack-users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            hack_id: hackId,
            user_id: userToAdd.id,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to add team member");
        }

        toast.success(
          `Added ${userToAdd.displayName || userToAdd.primaryEmail || "user"} to team`,
        );
      }

      // Update local state
      onUsersChange([...selectedUsers, userToAdd]);
      setOpenSearch(false);
      setSearchQuery("");
    } catch (error) {
      console.error("Error adding team member:", error);
      toast.error((error as Error).message || "Failed to add team member");
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleRemoveUser = async (userToRemove: ClientUser) => {
    setRemovingMemberId(userToRemove.id);

    try {
      if (mode === "edit" && hackId) {
        // For edit mode, remove user from the team via API
        const response = await fetch("/api/v1/hack-users", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            hack_id: hackId,
            user_id: userToRemove.id,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to remove team member");
        }

        toast.success(
          `Removed ${userToRemove.displayName || userToRemove.primaryEmail || "user"} from team`,
        );
      }

      // Update local state
      onUsersChange(selectedUsers.filter((u) => u.id !== userToRemove.id));
    } catch (error) {
      console.error("Error removing team member:", error);
      toast.error((error as Error).message || "Failed to remove team member");
    } finally {
      setRemovingMemberId(null);
    }
  };

  return (
    <div>
      <Label>Team members</Label>
      <p className="text-sm text-muted-foreground mb-3">
        {mode === "create"
          ? "You'll be automatically added to the team. Add additional members below."
          : "Manage your team members. Add or remove members as needed."}
      </p>

      {/* Current members display */}
      <div className="flex flex-wrap gap-2 mb-3">
        {showCurrentUser && (
          <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm font-medium">
            {user.displayName || user.primaryEmail} (You)
          </span>
        )}
        {selectedUsers.map((u) => (
          <span
            key={u.id}
            className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm flex items-center gap-2"
          >
            {u.displayName || u.primaryEmail || u.id}
            <button
              type="button"
              className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
              onClick={() => handleRemoveUser(u)}
              disabled={disabled || removingMemberId === u.id}
            >
              {removingMemberId === u.id ? (
                <div className="animate-spin rounded-full h-3 w-3 border-b border-gray-500"></div>
              ) : mode === "edit" ? (
                <UserMinus className="h-3 w-3" />
              ) : (
                <X className="h-3 w-3" />
              )}
            </button>
          </span>
        ))}
      </div>

      {/* Add member button */}
      <Popover open={openSearch} onOpenChange={setOpenSearch}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="flex items-center gap-2"
            disabled={disabled || isAddingMember}
          >
            {isAddingMember ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                Adding...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add team members
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[320px]">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search users by name or email"
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandEmpty>
              {searchQuery.trim()
                ? "No users found."
                : "Start typing to search..."}
            </CommandEmpty>
            <CommandGroup>
              {filteredUsers.map((u) => (
                <CommandItem
                  key={u.id}
                  disabled={selectedIds.has(u.id)}
                  onSelect={() => handleAddUser(u)}
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {u.displayName || u.primaryEmail || u.id}
                    </span>
                    {u.primaryEmail && u.displayName && (
                      <span className="text-xs text-muted-foreground">
                        {u.primaryEmail}
                      </span>
                    )}
                    {selectedIds.has(u.id) && (
                      <span className="text-xs text-green-600">
                        Already added
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
