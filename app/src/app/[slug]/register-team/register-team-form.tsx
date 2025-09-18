"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadCrop } from "@/components/image-upload-crop";
import { Command, CommandGroup, CommandItem, CommandInput, CommandEmpty } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type UserOption = { id: string; name: string | null; email: string | null };

export default function RegisterTeamForm({ slug, disabled }: { slug: string; disabled: boolean }) {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [teamImageFile, setTeamImageFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [openSearch, setOpenSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserOption[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([]);

  const selectedIds = useMemo(() => new Set(selectedUsers.map((u) => u.id)), [selectedUsers]);

  async function fetchUsers(q: string) {
    try {
      const res = await fetch(`/api/v1/user-search?q=${encodeURIComponent(q)}&limit=10`);
      const data = await res.json();
      setSearchResults((data.users || []) as UserOption[]);
    } catch (e) {
      console.error(e);
      setSearchResults([]);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setIsSubmitting(true);
    try {
      const form = new FormData();
      form.append("teamName", teamName);
      if (projectName) form.append("projectName", projectName);
      if (projectDescription) form.append("projectDescription", projectDescription);
      if (teamImageFile) form.append("teamImage", teamImageFile);
      const memberIds = selectedUsers.map((u) => u.id);
      form.append("memberIds", JSON.stringify(memberIds));

      const res = await fetch(`/api/v1/register-team/${slug}`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to register team");
      }
      router.push(`/${slug}`);
    } catch (error) {
      console.error(error);
      alert((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="teamName">Team name</Label>
          <Input id="teamName" value={teamName} onChange={(e) => setTeamName(e.target.value)} required disabled={disabled} />
        </div>
        <div>
          <Label htmlFor="projectName">Project name</Label>
          <Input id="projectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} disabled={disabled} />
        </div>
      </div>

      <div>
        <Label htmlFor="projectDescription">Project description</Label>
        <Textarea id="projectDescription" value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} rows={6} disabled={disabled} />
      </div>

      <div>
        <ImageUploadCrop label="Team image" onImageCropped={setTeamImageFile} onImageRemoved={() => setTeamImageFile(null)} />
      </div>

      <div>
        <Label>Team members</Label>
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedUsers.map((u) => (
            <span key={u.id} className="px-2 py-1 rounded bg-muted text-sm">
              {(u.name || u.email || u.id) as string}
              <button type="button" className="ml-2 text-muted-foreground" onClick={() => setSelectedUsers((prev) => prev.filter((x) => x.id !== u.id))}>
                ×
              </button>
            </span>
          ))}
        </div>
        <Popover open={openSearch} onOpenChange={setOpenSearch}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline">Add team members</Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[320px]">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search users by name"
                value={searchQuery}
                onValueChange={(v) => {
                  setSearchQuery(v);
                  fetchUsers(v);
                }}
              />
              <CommandEmpty>No users found.</CommandEmpty>
              <CommandGroup>
                {searchResults.map((u) => (
                  <CommandItem
                    key={u.id}
                    disabled={selectedIds.has(u.id)}
                    onSelect={() => {
                      if (!selectedIds.has(u.id)) setSelectedUsers((prev) => [...prev, u]);
                      setOpenSearch(false);
                    }}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm">{u.name || u.email || u.id}</span>
                      {u.email && <span className="text-xs text-muted-foreground">{u.email}</span>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || isSubmitting}>{isSubmitting ? "Submitting..." : "Register team"}</Button>
      </div>
    </form>
  );
}

