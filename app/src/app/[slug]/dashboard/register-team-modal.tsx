"use client";

import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadCrop } from "@/components/image-upload-crop";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Users, Plus } from "lucide-react";
import type { ClientUser } from "@/lib/client-user";
import { createTeamAction } from "@/lib/hackathons/optimistic-mutations";

type UserOption = { id: string; name: string | null; email: string | null };

interface RegisterTeamModalProps {
  eventId: string;
  eventSlug: string;
  user: ClientUser;
  disabled?: boolean;
  trigger?: React.ReactNode;
}

export function RegisterTeamModal({
  eventId,
  eventSlug,
  user,
  disabled = false,
  trigger,
}: RegisterTeamModalProps) {
  const [open, setOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [teamImageFile, setTeamImageFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [openSearch, setOpenSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserOption[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([]);

  const selectedIds = useMemo(
    () => new Set(selectedUsers.map((u) => u.id)),
    [selectedUsers],
  );

  // Create and cleanup object URL for image preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (teamImageFile) {
      const url = URL.createObjectURL(teamImageFile);
      setPreviewUrl(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setPreviewUrl(null);
    }
  }, [teamImageFile]);

  const resetForm = () => {
    setTeamName("");
    setProjectName("");
    setProjectDescription("");
    setTeamImageFile(null);
    setSelectedUsers([]);
    setSearchQuery("");
    setSearchResults([]);
  };

  async function fetchUsers(q: string) {
    try {
      const res = await fetch(
        `/api/v1/user-search?q=${encodeURIComponent(q)}&limit=10`,
      );
      const data = await res.json();
      setSearchResults((data.users || []) as UserOption[]);
    } catch (e) {
      console.error(e);
      setSearchResults([]);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || isSubmitting) return;

    if (!teamName.trim()) {
      toast.error("Team name is required");
      return;
    }

    setIsSubmitting(true);

    try {
      // Generate unique ID for the hack
      const hackId = crypto.randomUUID();

      // Handle image upload first if there's an image
      let teamImageId: string | null = null;
      if (teamImageFile) {
        const imageForm = new FormData();
        imageForm.append("image", teamImageFile);
        imageForm.append("eventSlug", eventSlug);

        const imageRes = await fetch("/api/v1/upload-team-image", {
          method: "POST",
          body: imageForm,
        });

        if (imageRes.ok) {
          const imageData = await imageRes.json();
          teamImageId = imageData.imageId;
        }
      }

      // Create the team using TanStack DB transaction
      const memberIds = [user.id, ...selectedUsers.map((u) => u.id)];
      const uniqueMemberIds = Array.from(new Set(memberIds));
      const now = new Date().toISOString();

      await createTeamAction({
        hackData: {
          id: hackId,
          event_id: eventId,
          team_name: teamName.trim(),
          project_name: projectName.trim() || null,
          project_description: projectDescription.trim() || null,
          team_image: teamImageId,
          created_at: now,
          updated_at: now,
        },
        userIds: uniqueMemberIds,
      });

      toast.success("Team registered successfully!");
      resetForm();
      setOpen(false);
    } catch (error) {
      console.error("Error registering team:", error);
      toast.error(
        (error as Error).message || "An error occurred while registering team",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const defaultTrigger = (
    <Button size="lg" className="flex items-center gap-2">
      <Users className="h-4 w-4" />
      Create a Team
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Your Team</DialogTitle>
          <DialogDescription>
            Create a team for this hackathon. You'll be automatically added as a
            team member.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-6" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="teamName">Team name *</Label>
              <Input
                id="teamName"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Enter your team name"
                required
                disabled={disabled || isSubmitting}
              />
            </div>
            <div>
              <Label htmlFor="projectName">Project name</Label>
              <Input
                id="projectName"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="What are you building?"
                disabled={disabled || isSubmitting}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="projectDescription">Project description</Label>
            <Textarea
              id="projectDescription"
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="Describe your project idea..."
              rows={4}
              disabled={disabled || isSubmitting}
            />
          </div>

          <div>
            <ImageUploadCrop
              label="Team image (optional)"
              onImageCropped={setTeamImageFile}
              onImageRemoved={() => setTeamImageFile(null)}
            />
            {teamImageFile && previewUrl && (
              <div className="mt-3">
                <p className="text-sm text-muted-foreground mb-2">Preview:</p>
                <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                  <img
                    src={previewUrl}
                    alt="Team image preview"
                    className="w-16 h-16 object-cover rounded-lg border"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {teamImageFile.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(teamImageFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setTeamImageFile(null)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>Team members</Label>
            <p className="text-sm text-muted-foreground mb-3">
              You'll be automatically added to the team. Add additional members
              below.
            </p>

            {/* Current user display */}
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm font-medium">
                {user.displayName || user.primaryEmail} (You)
              </span>
              {selectedUsers.map((u) => (
                <span
                  key={u.id}
                  className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm flex items-center gap-2"
                >
                  {(u.name || u.email || u.id) as string}
                  <button
                    type="button"
                    className="text-gray-500 hover:text-gray-700"
                    onClick={() =>
                      setSelectedUsers((prev) =>
                        prev.filter((x) => x.id !== u.id),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <Popover open={openSearch} onOpenChange={setOpenSearch}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="flex items-center gap-2"
                  disabled={disabled || isSubmitting}
                >
                  <Plus className="h-4 w-4" />
                  Add team members
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[320px]">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search users by name or email"
                    value={searchQuery}
                    onValueChange={(v) => {
                      setSearchQuery(v);
                      if (v.trim()) {
                        fetchUsers(v);
                      } else {
                        setSearchResults([]);
                      }
                    }}
                  />
                  <CommandEmpty>
                    {searchQuery.trim()
                      ? "No users found."
                      : "Start typing to search..."}
                  </CommandEmpty>
                  <CommandGroup>
                    {searchResults
                      .filter((u) => u.id !== user.id) // Exclude current user
                      .map((u) => (
                        <CommandItem
                          key={u.id}
                          disabled={selectedIds.has(u.id)}
                          onSelect={() => {
                            if (!selectedIds.has(u.id)) {
                              setSelectedUsers((prev) => [...prev, u]);
                            }
                            setOpenSearch(false);
                            setSearchQuery("");
                          }}
                        >
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {u.name || u.email || u.id}
                            </span>
                            {u.email && u.name && (
                              <span className="text-xs text-muted-foreground">
                                {u.email}
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

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={disabled || isSubmitting || !teamName.trim()}
            >
              {isSubmitting ? "Creating..." : "Create Team"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
