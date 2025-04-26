<script lang="ts">
  import { Play, Square } from "lucide-svelte";
  import { appSocket } from "$lib/state/SocketState.svelte";

  function start() {
    appSocket.userChannel?.push("start_countdown", {});
  }

  function stop() {
    appSocket.userChannel?.push("stop_countdown", {});
  }
</script>

<div class="mx-auto mt-10 flex flex-col items-center gap-6">
  <button class="btn btn-xl btn-neutral w-xs items-center gap-3" onclick={start}>
    <Play />
    Start Countdown
  </button>

  <button class="btn btn-xl btn-neutral w-xs items-center gap-3" onclick={stop}>
    <Square />
    Stop Countdown
  </button>
</div>
