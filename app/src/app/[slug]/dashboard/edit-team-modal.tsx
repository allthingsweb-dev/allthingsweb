"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ImageUploadCrop } from "@/components/image-upload-crop";
import { TeamMemberManagement } from "@/components/team-member-management";
import { Loader2, Save, Users, Edit, X } from "lucide-react";
import { toast } from "sonner";
import type { ClientUser } from "@/lib/client-user";
import { useUsers } from "@/hooks/use-users";

interface Team {
  id: string;
  teamName: string;
  projectName: string | null;
  projectDescription: string | null;
  projectLink: string | null;
  imageUrl?: string;
  imageAlt?: string;
  memberIds?: string[];
}

interface EditTeamModalProps {
  hackId: string;
  user: ClientUser;
  isAdmin?: boolean;
  trigger?: React.ReactNode;
  onTeamUpdated?: (team: Team) => void;
}

export function EditTeamModal({
  hackId,
  user,
  isAdmin = false,
  trigger,
  onTeamUpdated,
}: EditTeamModalProps) {
  const { users } = useUsers();
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<Team | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<ClientUser[]>([]);
  const [formData, setFormData] = useState({
    teamName: "",
    projectName: "",
    projectDescription: "",
    projectLink: "",
  });

  // Convert member IDs to user objects for the team member management component
  const teamMembers = useMemo(() => {
    if (!team?.memberIds) return [];

    return team.memberIds
      .filter((id) => id !== user.id) // Exclude current user
      .map((id) => {
        const userInfo = users.find((u) => u.id === id);
        return (
          userInfo || {
            id,
            displayName: null,
            primaryEmail: null,
            profileImageUrl: null,
          }
        );
      });
  }, [team?.memberIds, user.id, users]);

  // Fetch team data when modal opens
  useEffect(() => {
    if (!open) return;

    async function fetchTeam() {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/v1/teams/${hackId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.team) {
            setTeam(data.team);
            setFormData({
              teamName: data.team.teamName || "",
              projectName: data.team.projectName || "",
              projectDescription: data.team.projectDescription || "",
              projectLink: data.team.projectLink || "",
            });

            // Selected users will be initialized by the separate useEffect
          }
        } else if (response.status === 403) {
          const errorMessage = isAdmin
            ? "Team not found or access denied"
            : "You are not a member of this team";
          toast.error(errorMessage);
          setOpen(false);
        } else {
          console.error("Error fetching team:", response.statusText);
          toast.error("Failed to load team data");
        }
      } catch (error) {
        console.error("Error fetching team:", error);
        toast.error("Failed to load team data");
      } finally {
        setIsLoading(false);
      }
    }

    fetchTeam();
  }, [open, hackId, user.id]);

  // Update selected users when users data changes (to get updated names)
  useEffect(() => {
    if (team?.memberIds && users.length > 0) {
      const teamMemberUsers = team.memberIds
        .filter((id: string) => id !== user.id) // Exclude current user
        .map((id: string) => {
          const userInfo = users.find((u) => u.id === id);
          return (
            userInfo || {
              id,
              displayName: null,
              primaryEmail: null,
              profileImageUrl: null,
            }
          );
        });
      setSelectedUsers(teamMemberUsers);
    }
  }, [users, team?.memberIds, user.id]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleImageCropped = (croppedFile: File) => {
    setImageFile(croppedFile);
    // Create preview URL for the cropped image
    const url = URL.createObjectURL(croppedFile);
    setPreviewUrl(url);
  };

  const handleImageRemoved = async () => {
    try {
      const response = await fetch(`/api/v1/teams/${hackId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        const data = await response.json();
        setTeam(data.team);
        toast.success("Team image removed successfully");
        if (onTeamUpdated) {
          onTeamUpdated(data.team);
        }
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || "Failed to remove team image");
      }
    } catch (error) {
      console.error("Error removing team image:", error);
      toast.error("An unexpected error occurred");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const formDataToSend = new FormData();
      formDataToSend.append("teamName", formData.teamName);

      if (formData.projectName) {
        formDataToSend.append("projectName", formData.projectName);
      }
      if (formData.projectDescription) {
        formDataToSend.append(
          "projectDescription",
          formData.projectDescription,
        );
      }
      if (formData.projectLink) {
        formDataToSend.append("projectLink", formData.projectLink);
      }

      if (imageFile) {
        formDataToSend.append("teamImage", imageFile);
      }

      const response = await fetch(`/api/v1/teams/${hackId}`, {
        method: "PUT",
        body: formDataToSend,
      });

      if (response.ok) {
        const data = await response.json();
        setTeam(data.team);
        setImageFile(null);
        // Clean up preview URL
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl(null);
        }
        toast.success("Team updated successfully");
        if (onTeamUpdated) {
          onTeamUpdated(data.team);
        }
        setOpen(false);
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || "Failed to update team");
      }
    } catch (error) {
      console.error("Error updating team:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Edit className="h-4 w-4 mr-2" />
            Edit Team
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Edit Team
          </DialogTitle>
          <DialogDescription>
            Update your team information and project details
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Team Image */}
            <ImageUploadCrop
              onImageCropped={handleImageCropped}
              onImageRemoved={handleImageRemoved}
              currentImageUrl={team?.imageUrl}
              label="Team Image"
              aspectRatio={1} // Square aspect ratio
              maxWidth={800}
              maxHeight={800}
            />
            {imageFile && previewUrl && (
              <div className="mt-3">
                <p className="text-sm text-muted-foreground mb-2">
                  New image preview:
                </p>
                <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                  <img
                    src={previewUrl}
                    alt="New team image preview"
                    className="w-16 h-16 object-cover rounded-lg border"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {imageFile.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(imageFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setImageFile(null);
                      if (previewUrl) {
                        URL.revokeObjectURL(previewUrl);
                        setPreviewUrl(null);
                      }
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Team Name */}
            <div>
              <Label htmlFor="teamName">Team Name *</Label>
              <Input
                id="teamName"
                value={formData.teamName}
                onChange={(e) => handleInputChange("teamName", e.target.value)}
                placeholder="Enter your team name"
                required
              />
            </div>

            {/* Project Name */}
            <div>
              <Label htmlFor="projectName">Project Name</Label>
              <Input
                id="projectName"
                value={formData.projectName}
                onChange={(e) =>
                  handleInputChange("projectName", e.target.value)
                }
                placeholder="What are you building? (Optional)"
              />
            </div>

            {/* Project Description */}
            <div>
              <Label htmlFor="projectDescription">Project Description</Label>
              <Textarea
                id="projectDescription"
                value={formData.projectDescription}
                onChange={(e) =>
                  handleInputChange("projectDescription", e.target.value)
                }
                placeholder="Describe your project, the problem it solves, technologies used, etc. (Optional)"
                rows={4}
              />
            </div>

            {/* Project Link */}
            <div>
              <Label htmlFor="projectLink">Project Link</Label>
              <Input
                id="projectLink"
                value={formData.projectLink}
                onChange={(e) =>
                  handleInputChange("projectLink", e.target.value)
                }
                placeholder="https://github.com/your-repo or demo link (Optional)"
              />
            </div>

            {/* Team Member Management */}
            <TeamMemberManagement
              user={user}
              selectedUsers={selectedUsers}
              onUsersChange={setSelectedUsers}
              disabled={isSaving}
              hackId={hackId}
              showCurrentUser={true}
              mode="edit"
            />

            {/* Submit Button */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={isSaving || !formData.teamName}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Update Team
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
