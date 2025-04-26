<script lang="ts">
  import { page } from "$app/state";

  const links = [
    { href: "/", label: "QR Code" },
    { href: "/hacks", label: "Hacks" },
    { href: "/results", label: "Results" },
  ];
</script>

{#snippet link(href: string, label: string)}
  <a {href} role="tab" class={["tab w-1/3", page.url.pathname === href && "tab-active"]}>
    {label}
  </a>
{/snippet}

<div role="tablist" class="tabs tabs-box mx-auto my-4 flex justify-between">
  {#each links as { href, label }}
    {@render link(href, label)}
  {/each}
</div>
