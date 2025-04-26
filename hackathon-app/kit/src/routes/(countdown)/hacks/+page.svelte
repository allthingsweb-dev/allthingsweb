<script lang="ts">
  import HackCard from "$lib/components/HackCard.svelte";

  import { appCurrentUser } from "$lib/state/CurrentUserState.svelte";
  import { appSocket } from "$lib/state/SocketState.svelte";
</script>

<p class="mt-8 text-center text-2xl font-medium">Vote for your favorite hack!</p>

{#if !appCurrentUser.user}
  <div class="space-y-2">
    <p class="text-center text-lg">Log in or create an account to vote.</p>

    <div class="flex justify-center gap-3">
      <a href="/users/log-in" class="btn btn-accent">Log in</a>
      <a href="/users/register" class="btn btn-neutral">Register</a>
    </div>
  </div>
{/if}

<div class="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
  {#each appSocket.hacks as hack (hack.id)}
    <HackCard {hack} />
  {/each}
</div>
