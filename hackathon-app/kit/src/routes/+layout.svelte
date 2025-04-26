<script lang="ts">
  import "../app.css";

  import AccountButton from "$lib/components/AccountButton.svelte";
  import NavigationTabs from "$lib/components/NavigationTabs.svelte";

  let { children } = $props();
</script>

<div class="navbar justify-between shadow">
  <h1>
    <a class="btn btn-ghost text-left sm:text-xl" href="/">All Things Web Hackathon</a>
  </h1>

  <AccountButton />
</div>

<div class="mb-16">
  <NavigationTabs />

  {@render children()}
</div>
