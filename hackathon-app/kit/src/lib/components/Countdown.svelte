<script lang="ts">
  import { appSocket } from "$lib/state/SocketState.svelte";

  $effect(() => {
    const intervalId = setInterval(() => {
      const deadline = appSocket.countdown.deadline;
      const now = new Date();

      const diffMs = deadline.getTime() - now.getTime();

      if (diffMs > 0) {
        const totalSeconds = Math.floor(diffMs / 1000);
        appSocket.countdown = {
          ...appSocket.countdown,
          minutes: Math.floor(totalSeconds / 60),
          seconds: totalSeconds % 60,
        };
      } else {
        appSocket.countdown = {
          ...appSocket.countdown,
          minutes: 0,
          seconds: 0,
        };
      }
    }, 1000);

    return () => clearInterval(intervalId);
  });
</script>

{#snippet countdown(value: number, unit: string)}
  <div class="bg-neutral rounded-box text-neutral-content flex flex-col p-2">
    <span class="countdown font-mono text-5xl">
      <span style="--value:{value};" aria-live="polite" aria-label={value.toString()}>
        {value}
      </span>
    </span>
    {unit}
  </div>
{/snippet}

<div class="mt-6 text-center text-2xl font-medium">
  {#if appSocket.countdown.running}
    Voting closes in
  {:else}
    Voting closed
  {/if}
</div>

<div class="my-3 flex justify-center">
  <div class="grid auto-cols-max grid-flow-col gap-5 text-center">
    {@render countdown(appSocket.countdown.minutes, "min")}
    {@render countdown(appSocket.countdown.seconds, "sec")}
  </div>
</div>
