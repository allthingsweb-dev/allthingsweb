<script lang="ts">
  import { confetti } from "@neoconfetti/svelte";

  import Countdown from "$lib/components/Countdown.svelte";
  import { appSocket } from "$lib/state/SocketState.svelte";

  let { children } = $props();
</script>

{#if appSocket.showConfetti}
  <div use:confetti={{ stageHeight: window.innerHeight }}></div>
{/if}

{#if appSocket.mounted}
  <Countdown />
  {@render children()}
{/if}
