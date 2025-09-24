"use client";

import { useState, useEffect } from "react";
import type { ClientUser } from "@/lib/client-user";

export function useUsers() {
  const [users, setUsers] = useState<ClientUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/v1/users");
      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }
      const data = await response.json();
      setUsers(data.users || []);
      setError(null);
    } catch (err) {
      console.error("Error fetching users:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch users");
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchUsers();
  }, []);

  // Set up interval to refetch every minute
  useEffect(() => {
    const interval = setInterval(fetchUsers, 60 * 1000); // 1 minute
    return () => clearInterval(interval);
  }, []);

  return {
    users,
    isLoading,
    error,
    refetch: fetchUsers,
  };
}
