"use client";

import { useState, useEffect } from "react";
import { useUser } from "@stackframe/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageUploadCrop } from "@/components/image-upload-crop";
import { Loader2, Save, User } from "lucide-react";
import { toast } from "sonner";

interface Profile {
  id: string;
  name: string;
  title: string;
  bio: string;
  profileType: "organizer" | "member";
  twitterHandle: string | null;
  blueskyHandle: string | null;
  linkedinHandle: string | null;
  imageUrl?: string;
  imageAlt?: string;
}

export function ProfileForm() {
  const user = useUser({ or: "redirect" });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    title: "",
    bio: "",
    twitterHandle: "",
    blueskyHandle: "",
    linkedinHandle: "",
  });

  // Fetch existing profile
  useEffect(() => {
    async function fetchProfile() {
      try {
        const response = await fetch("/api/v1/profile");
        if (response.ok) {
          const data = await response.json();
          if (data.profile) {
            setProfile(data.profile);
            setFormData({
              name: data.profile.name || "",
              title: data.profile.title || "",
              bio: data.profile.bio || "",
              twitterHandle: data.profile.twitterHandle || "",
              blueskyHandle: data.profile.blueskyHandle || "",
              linkedinHandle: data.profile.linkedinHandle || "",
            });
          }
        } else if (response.status !== 404) {
          console.error("Error fetching profile:", response.statusText);
        }
      } catch (error) {
        console.error("Error fetching profile:", error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchProfile();
  }, []);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleImageCropped = (croppedFile: File) => {
    setImageFile(croppedFile);
  };

  const handleImageRemoved = async () => {
    try {
      const response = await fetch("/api/v1/profile", {
        method: "DELETE",
      });

      if (response.ok) {
        const data = await response.json();
        setProfile(data.profile);
        toast.success("Profile image removed successfully");
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || "Failed to remove profile image");
      }
    } catch (error) {
      console.error("Error removing profile image:", error);
      toast.error("An unexpected error occurred");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const formDataToSend = new FormData();
      formDataToSend.append("name", formData.name);
      formDataToSend.append("title", formData.title);
      formDataToSend.append("bio", formData.bio);

      if (formData.twitterHandle) {
        formDataToSend.append("twitterHandle", formData.twitterHandle);
      }
      if (formData.blueskyHandle) {
        formDataToSend.append("blueskyHandle", formData.blueskyHandle);
      }
      if (formData.linkedinHandle) {
        formDataToSend.append("linkedinHandle", formData.linkedinHandle);
      }

      if (imageFile) {
        formDataToSend.append("image", imageFile);
      }

      const method = profile ? "PUT" : "POST";
      const response = await fetch("/api/v1/profile", {
        method,
        body: formDataToSend,
      });

      if (response.ok) {
        const data = await response.json();
        setProfile(data.profile);
        setImageFile(null);
        toast.success(
          profile
            ? "Profile updated successfully"
            : "Profile created successfully",
        );
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || "Failed to save profile");
      }
    } catch (error) {
      console.error("Error saving profile:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {profile ? "Edit Profile" : "Create Profile"}
          </CardTitle>
          {profile ? (
            <p className="text-sm text-muted-foreground">
              Update your speaker profile information
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Create your speaker profile to appear in our events
            </p>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Profile Image */}
            <ImageUploadCrop
              onImageCropped={handleImageCropped}
              onImageRemoved={handleImageRemoved}
              currentImageUrl={profile?.imageUrl}
              label="Profile Image"
              aspectRatio={1} // Square aspect ratio
              maxWidth={800}
              maxHeight={800}
            />

            {/* Name */}
            <div>
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange("name", e.target.value)}
                placeholder="Enter your full name"
                required
              />
            </div>

            {/* Title */}
            <div>
              <Label htmlFor="title">Professional Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => handleInputChange("title", e.target.value)}
                placeholder="e.g., Senior Software Engineer, CTO, etc."
                required
              />
            </div>

            {/* Bio */}
            <div>
              <Label htmlFor="bio">Bio *</Label>
              <Textarea
                id="bio"
                value={formData.bio}
                onChange={(e) => handleInputChange("bio", e.target.value)}
                placeholder="Tell us about yourself, your experience, and expertise..."
                rows={4}
                required
              />
            </div>

            {/* Social Media Handles */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Social Media (Optional)</h3>

              <div>
                <Label htmlFor="twitterHandle">Twitter/X Handle</Label>
                <Input
                  id="twitterHandle"
                  value={formData.twitterHandle}
                  onChange={(e) =>
                    handleInputChange("twitterHandle", e.target.value)
                  }
                  placeholder="@yourusername"
                />
              </div>

              <div>
                <Label htmlFor="blueskyHandle">Bluesky Handle</Label>
                <Input
                  id="blueskyHandle"
                  value={formData.blueskyHandle}
                  onChange={(e) =>
                    handleInputChange("blueskyHandle", e.target.value)
                  }
                  placeholder="@yourusername.bsky.social"
                />
              </div>

              <div>
                <Label htmlFor="linkedinHandle">LinkedIn Handle</Label>
                <Input
                  id="linkedinHandle"
                  value={formData.linkedinHandle}
                  onChange={(e) =>
                    handleInputChange("linkedinHandle", e.target.value)
                  }
                  placeholder="your-linkedin-username"
                />
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              disabled={
                isSaving || !formData.name || !formData.title || !formData.bio
              }
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {profile ? "Updating..." : "Creating..."}
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {profile ? "Update Profile" : "Create Profile"}
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
