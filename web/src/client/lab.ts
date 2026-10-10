import type { Engine, MakeEngine, Pointer, Tile } from "./engine.ts";

/**
 * The lab's one script (pages/lab/), which only pages with an engine load.
 * It finds each surface marked `data-engine`, and when one comes near the
 * screen it loads that engine alone, draws it over the surface's own
 * photos in WebGL2, and stirs it with the pointer, a mouse or a finger,
 * anywhere over the surface's stage (`data-engine-stage`). It runs only
 * while the surface is on screen and the tab is shown.
 *
 * Without script, WebGL2 or float targets, or for people who prefer
 * reduced motion, nothing starts: the surface keeps its still composition.
 */

/** An engine's module: how to make it, and how sharp it draws at most. */
interface EngineModule {
  readonly make: MakeEngine;
  readonly maxScale?: number;
}

const engines: Readonly<Record<string, () => Promise<EngineModule>>> = {
  fluid: () => import("./engines/fluid.ts"),
  springs: () => import("./engines/springs.ts"),
  ripples: () => import("./engines/ripples.ts"),
  liquid: () => import("./engines/liquid.ts"),
};

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/** Canvases are drawn at most at twice their CSS size. */
const maxScale = 2;

/** The surface's photos where its first list of tiles lays them out. */
async function tilesOf(surface: HTMLElement): Promise<ReadonlyArray<Tile>> {
  const list = surface.querySelector<HTMLElement>("[data-engine-tiles]");
  if (list === null) return [];
  const origin = list.getBoundingClientRect();
  const images = [...list.querySelectorAll("img")];
  // Wait a moment for photos still on their way; draw what has come.
  await Promise.race([
    Promise.allSettled(images.map((image) => image.decode())),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);
  return images
    .filter((image) => image.complete && image.naturalWidth > 0)
    .map((image) => {
      const box = image.getBoundingClientRect();
      return {
        image,
        x: box.left - origin.left,
        y: box.top - origin.top,
        width: box.width,
        height: box.height,
      };
    });
}

async function start(surface: HTMLElement): Promise<void> {
  const load = engines[surface.dataset["engine"] ?? ""];
  if (load === undefined || reducedMotion.matches) return;
  const stage = surface.closest<HTMLElement>("[data-engine-stage]") ?? surface;
  const canvas = document.createElement("canvas");
  canvas.className = "engine-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: "high-performance",
  });
  if (gl === null) return;
  let engine: Engine;
  let sharpest = maxScale;
  try {
    const [module, tiles] = await Promise.all([load(), tilesOf(surface)]);
    if (tiles.length === 0) return;
    engine = module.make({ gl, canvas, tiles });
    sharpest = Math.min(maxScale, module.maxScale ?? maxScale);
  } catch (error) {
    console.warn(
      "The lab's engine didn't start; the still composition stays.",
      error,
    );
    return;
  }
  surface.append(canvas);
  stage.dataset["engineLive"] = "";

  const resize = () => {
    const box = surface.getBoundingClientRect();
    const scale = Math.min(devicePixelRatio || 1, sharpest);
    canvas.width = Math.max(1, Math.round(box.width * scale));
    canvas.height = Math.max(1, Math.round(box.height * scale));
    engine.resize(box.width, box.height, scale);
  };
  resize();
  new ResizeObserver(resize).observe(surface);

  let last: { x: number; y: number } | undefined;
  const move = (event: PointerEvent) => {
    const box = surface.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const pointer: Pointer = {
      x,
      y,
      dx: last === undefined ? 0 : x - last.x,
      dy: last === undefined ? 0 : y - last.y,
      pressed: event.type === "pointerdown" || event.buttons > 0,
    };
    last = { x, y };
    engine.pointer(pointer);
  };
  stage.addEventListener("pointermove", move, { passive: true });
  stage.addEventListener("pointerdown", move, { passive: true });
  stage.addEventListener("pointerleave", () => (last = undefined), {
    passive: true,
  });

  // Frames only while the surface is on screen and the tab is shown.
  let onScreen = false;
  let frame = 0;
  let previous = 0;
  const tick = (now: number) => {
    const step =
      previous === 0 ? 1 / 60 : Math.min((now - previous) / 1000, 1 / 20);
    previous = now;
    engine.frame(now / 1000, step);
    frame = requestAnimationFrame(tick);
  };
  const run = () => {
    const running = frame !== 0;
    const wanted = onScreen && !document.hidden && !reducedMotion.matches;
    if (wanted && !running) {
      previous = 0;
      frame = requestAnimationFrame(tick);
    } else if (!wanted && running) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? false;
    run();
  }).observe(surface);
  document.addEventListener("visibilitychange", run);
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      delete stage.dataset["engineLive"];
      canvas.remove();
    }
    run();
  });
}

/** Starts each surface's engine as it comes within a screen of view. */
const near = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      near.unobserve(entry.target);
      if (entry.target instanceof HTMLElement) void start(entry.target);
    }
  },
  { rootMargin: "100% 0px" },
);
for (const surface of document.querySelectorAll<HTMLElement>("[data-engine]")) {
  near.observe(surface);
}
