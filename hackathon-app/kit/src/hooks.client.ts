import type { ClientInit } from "@sveltejs/kit";

import { appCurrentUser } from "$lib/state/CurrentUserState.svelte";
import { appSocket } from "$lib/state/SocketState.svelte";

export const init: ClientInit = async () => {
  await appCurrentUser.getCurrentUser();
  appSocket.connect();
};
