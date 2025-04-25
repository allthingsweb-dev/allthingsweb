<script lang="ts">
  import { Crown } from "lucide-svelte";
  import { flip } from "svelte/animate";
  import { fly } from "svelte/transition";

  import { appSocket } from "$lib/state/SocketState.svelte";
  import type { HackWithRank } from "$lib/state/SocketState.svelte";
</script>

{#snippet hackItem(hack: HackWithRank)}
  <li class="list-row items-center">
    <div class="flex flex-col items-center text-4xl font-thin tabular-nums opacity-30">
      {#if hack.rank === 1}
        <Crown class="text-yellow-600" />
      {/if}

      {hack.rank < 10 ? `0${hack.rank}` : hack.rank}
    </div>

    <div class="list-col-grow">
      <div class={["text-base-content/90 text-3xl", appSocket.countdown.running && "blur-sm"]}>
        {hack.name}
      </div>
    </div>

    <div class="flex flex-col items-center">
      {#key hack.votes}
        <div class="text-2xl font-thin tabular-nums" in:fly={{ x: 15 }}>
          {hack.votes}
        </div>
      {/key}
      votes
    </div>
  </li>
{/snippet}

<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
  {#each appSocket.categories as category}
    <div class="mt-8">
      <h2 class="text-center text-4xl font-medium">Most {category.name}</h2>

      <ul class="list rounded-box mt-4 shadow">
        {#each category.hacks as hack (hack.id)}
          <div animate:flip>
            {@render hackItem(hack)}
          </div>
        {/each}
      </ul>
    </div>
  {/each}
</div>
