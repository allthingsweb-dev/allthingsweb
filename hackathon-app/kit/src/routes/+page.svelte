<script lang="ts">
  import QRCode from "$lib/components/QRCode.svelte";
</script>

<p class="my-8 text-center text-2xl font-bold">
  Welcome to the All Things Web Hackathon Voting App!
</p>

<div class="my-8 flex justify-center gap-3">
  <a href="/hacks" class="btn btn-accent">Vote</a>
  <a href="/results" class="btn btn-neutral">See Results</a>
</div>

<div class="flex justify-center">
  <QRCode />
</div>

<div class="text-center">
  <a href="/" class="text-2xl underline underline-offset-4 transition hover:no-underline">
    https://hack.allthingsweb.dev
  </a>
</div>
