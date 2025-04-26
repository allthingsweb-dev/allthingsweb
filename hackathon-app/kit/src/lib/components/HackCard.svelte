<script lang="ts">
  import { Check, ThumbsUp } from "lucide-svelte";

  import { appCurrentUser } from "$lib/state/CurrentUserState.svelte";
  import { appSocket } from "$lib/state/SocketState.svelte";
  import type { Hack } from "$lib/state/SocketState.svelte";

  let { hack }: { hack: Hack } = $props();

  function vote(category_id: string) {
    appSocket.userChannel?.push("vote", { category_id: category_id, hack_id: hack.id });
  }
</script>

<div class="card shadow">
  <div class="card-body">
    <h2 class="card-title">{hack.name}</h2>

    <p>{hack.description}</p>

    <div class="card-actions mt-1">
      {#each hack.categories as category}
        {@const voted = Boolean(
          appSocket.userVotes.find(
            ({ category_id, hack_id }) => category_id === category.id && hack_id === hack.id,
          ),
        )}

        <div class="flex w-full items-center justify-between">
          <button
            class={["btn w-52", voted ? "btn-success" : "btn-neutral"]}
            disabled={!appCurrentUser.user || !appSocket.countdown.running}
            onclick={() => vote(category.id)}
          >
            {#if voted}
              Voted Most {category.name}
              <Check size={20} />
            {:else}
              Vote Most {category.name}
            {/if}
          </button>

          <div class="flex items-center gap-2">
            <span class={[appSocket.countdown.running && "bg-neutral blur-sm"]}>
              {category.votes}
            </span>
            votes
            <ThumbsUp />
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
