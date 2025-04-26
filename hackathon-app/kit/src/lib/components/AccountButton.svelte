<script lang="ts">
  import { User } from "lucide-svelte";

  import { clickOutside } from "$lib/actions/clickOutside";
  import { appCurrentUser } from "$lib/state/CurrentUserState.svelte";

  let isMenuOpen = $state(false);
</script>

<div class="relative" use:clickOutside={() => (isMenuOpen = false)}>
  <button class="btn btn-ghost gap-3" onclick={() => (isMenuOpen = !isMenuOpen)}>
    {#if appCurrentUser.user}
      <span class="hidden sm:block">
        {appCurrentUser.user.email}
      </span>
    {/if}
    <User />
  </button>

  {#if isMenuOpen}
    <div class="menu bg-base-200 rounded-box absolute right-0 z-20 mt-1 shadow">
      <div class="sm:hidden">
        {#if appCurrentUser.user}
          <div class="px-3 py-1">
            {appCurrentUser.user.email}
          </div>
          <div class="divider my-0"></div>
        {/if}
      </div>

      <ul>
        {#if appCurrentUser.user && ["2dc85741-ec60-41bc-a493-3db1f8d48914", "8623b244-9ee6-471f-b238-0ece985689c9"].includes(appCurrentUser.user.id)}
          <li><a href="/admin">Admin</a></li>
        {/if}
        {#if appCurrentUser.user}
          <li><a href="/users/settings" data-sveltekit-reload>Settings</a></li>
          <li><a href="/users/log-out" data-sveltekit-reload>Log out</a></li>
        {:else}
          <li><a href="/users/log-in" data-sveltekit-reload>Log in</a></li>
          <li><a href="/users/register" data-sveltekit-reload>Register</a></li>
        {/if}
      </ul>
    </div>
  {/if}
</div>
