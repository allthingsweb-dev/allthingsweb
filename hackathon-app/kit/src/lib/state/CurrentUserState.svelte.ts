interface User {
  id: string;
  email: string;
  token: string;
}

class CurrentUserState {
  user = $state<User>();

  getCurrentUser = async () => {
    const res = await fetch("/api/me");

    if (res.ok) {
      const user = await res.json();
      this.user = user;
    }
  };
}

export const appCurrentUser = new CurrentUserState();
