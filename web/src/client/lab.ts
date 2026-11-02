import type { Engine, MakeEngine, Pointer, Tile } from "./engine.ts";
import { linked } from "./gl.ts";

/**
 * The lab's one script (pages/lab/), which only pages with an engine load.
 * It finds each surface marked `data-engine`, and when one comes near the
 * screen it loads that engine alone, draws it over the surface's own
 * photos in WebGL2, and stirs it with the pointer, a mouse or a finger,
 * anywhere over the surface's stage (`data-engine-stage`). It runs only
 * while the surface is on screen and the tab is shown.
 *
 * The stage shows once, finished: it is marked `data-engine-ready` when
 * the engine has drawn its first frame, with every photo in it, or when it
 * can't run and the still composition has its photos. Until then the
 * stylesheet may keep the surface out of sight, so nothing is seen
 * arriving, and a stage marked ready fades in. Everything slow happens
 * before that, off the page's way: the photos decode, the GPU compiles the
 * shaders in the background (gl.ts), and the canvas is sized once.
 *
 * Without script, WebGL2 or float targets, or for people who prefer
 * reduced motion, nothing starts until they no longer do: the surface keeps
 * its still composition.
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

/**
 * How long a stage waits for its photos before it shows what came: on a
 * very slow connection, the page doesn't wait for the last of them.
 */
const photoWait = 8000;

/**
 * Those of `images` that lie within the surface: the ones it shows. A
 * photo past its edge (the letters' photos run on beyond the page) is
 * never seen, and a lazy one never loads.
 */
const within = (
  surface: HTMLElement,
  images: Iterable<HTMLImageElement>,
): ReadonlyArray<HTMLImageElement> => {
  const box = surface.getBoundingClientRect();
  return [...images].filter((image) => {
    const at = image.getBoundingClientRect();
    return (
      at.right > box.left &&
      at.left < box.right &&
      at.bottom > box.top &&
      at.top < box.bottom
    );
  });
};

/** The images of the surface's first list of tiles it shows: the ones an engine draws. */
const tileImages = (surface: HTMLElement): ReadonlyArray<HTMLImageElement> =>
  within(
    surface,
    surface.querySelector("[data-engine-tiles]")?.querySelectorAll("img") ?? [],
  );

/** Every one of `images` decoded, or failed, or {@link photoWait} passed. */
const settled = (images: ReadonlyArray<HTMLImageElement>): Promise<unknown> =>
  Promise.race([
    Promise.allSettled(images.map((image) => image.decode())),
    new Promise((resolve) => setTimeout(resolve, photoWait)),
  ]);

/** The stage shows: as it is, with the engine's first frame or without. */
const ready = (stage: HTMLElement) => {
  stage.dataset["engineReady"] = "";
};

/** The surface's photos where its first list of tiles lays them out. */
async function tilesOf(surface: HTMLElement): Promise<ReadonlyArray<Tile>> {
  const list = surface.querySelector<HTMLElement>("[data-engine-tiles]");
  if (list === null) return [];
  const images = tileImages(surface);
  await settled(images);
  // Measured once they are all in, where the layout has put them.
  const origin = list.getBoundingClientRect();
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

/** The stage of `surface`: where the pointer stirs it, and what is marked. */
const stageOf = (surface: HTMLElement): HTMLElement =>
  surface.closest<HTMLElement>("[data-engine-stage]") ?? surface;

/**
 * The still composition, for a surface whose engine can't run: shown once
 * every photo it shows is in, its tiles and anything else (depth-field's
 * lenses), so it too appears finished.
 */
async function still(surface: HTMLElement): Promise<void> {
  await settled(within(surface, surface.querySelectorAll("img")));
  ready(stageOf(surface));
}

async function start(surface: HTMLElement): Promise<void> {
  const stage = stageOf(surface);
  const load = engines[surface.dataset["engine"] ?? ""];
  if (load === undefined) return still(surface);
  const canvas = document.createElement("canvas");
  canvas.className = "engine-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: "high-performance",
  });
  if (gl === null) return still(surface);
  let engine: Engine;
  let sharpest = maxScale;
  try {
    const [module, tiles] = await Promise.all([load(), tilesOf(surface)]);
    if (tiles.length === 0) return still(surface);
    engine = module.make({ gl, canvas, tiles });
    sharpest = Math.min(maxScale, module.maxScale ?? maxScale);
    // The shaders compile while the page goes on; nothing draws before.
    await linked(gl);
  } catch (error) {
    console.warn(
      "The lab's engine didn't start; the still composition stays.",
      error,
    );
    return still(surface);
  }
  // The canvas shows, and the still photos hide, only while it runs.
  const show = () => {
    surface.append(canvas);
    stage.dataset["engineLive"] = "";
  };
  const hide = () => {
    delete stage.dataset["engineLive"];
    canvas.remove();
  };

  let failed = false;
  let frame = 0;
  const resizes = new ResizeObserver(() => resize());
  const sight = new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? false;
    run();
  });
  /** An engine that throws stops for good, and the still composition stays. */
  const fail = (error: unknown) => {
    failed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    resizes.disconnect();
    sight.disconnect();
    hide();
    ready(stage);
    console.warn(
      "The lab's engine stopped; the still composition stays.",
      error,
    );
  };

  /** The size the engine was last given, so the same size isn't given twice. */
  let sized = "";
  const resize = () => {
    if (failed) return;
    const box = surface.getBoundingClientRect();
    const scale = Math.min(devicePixelRatio || 1, sharpest);
    const size = `${box.width}x${box.height}@${scale}`;
    // Remaking the photos' texture is the slowest thing an engine does:
    // only for a size it hasn't drawn at (the first observation is not one).
    if (size === sized) return;
    sized = size;
    canvas.width = Math.max(1, Math.round(box.width * scale));
    canvas.height = Math.max(1, Math.round(box.height * scale));
    try {
      engine.resize(box.width, box.height, scale);
    } catch (error) {
      // Such as photos another origin sent without CORS, which WebGL refuses.
      fail(error);
    }
  };
  resize();
  if (failed) return;
  // The first frame is drawn before anything shows, so the stage shows
  // finished, the engine already running. Reduced motion may have been
  // chosen while the engine loaded: then the still composition shows.
  if (!reducedMotion.matches) {
    try {
      engine.frame(performance.now() / 1000, 1 / 60);
    } catch (error) {
      fail(error);
      return;
    }
    show();
  }
  ready(stage);
  resizes.observe(surface);

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
  let previous = 0;
  const tick = (now: number) => {
    const step =
      previous === 0 ? 1 / 60 : Math.min((now - previous) / 1000, 1 / 20);
    previous = now;
    try {
      engine.frame(now / 1000, step);
    } catch (error) {
      fail(error);
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  const run = () => {
    const running = frame !== 0;
    const wanted =
      !failed && onScreen && !document.hidden && !reducedMotion.matches;
    if (wanted && !running) {
      previous = 0;
      frame = requestAnimationFrame(tick);
    } else if (!wanted && running) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  sight.observe(surface);
  document.addEventListener("visibilitychange", run);
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) hide();
    else if (!failed && !canvas.isConnected) show();
    run();
  });
}

/**
 * After the page's first paint: making a WebGL context can hold the main
 * thread, and the page's text shouldn't wait for it.
 */
const afterFirstPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );

/** Surfaces that came near while reduced motion was chosen. */
const deferred = new Set<HTMLElement>();
const near = new IntersectionObserver(
  (entries) => {
    for (const { isIntersecting, target: surface } of entries) {
      if (!isIntersecting || !(surface instanceof HTMLElement)) continue;
      near.unobserve(surface);
      if (reducedMotion.matches) {
        deferred.add(surface);
        void still(surface);
      } else void afterFirstPaint().then(() => start(surface));
    }
  },
  { rootMargin: "100% 0px" },
);
// Once reduced motion is no longer chosen, the surfaces it held back start.
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) return;
  for (const surface of deferred) void start(surface);
  deferred.clear();
});
/** Starts each surface's engine as it comes within a screen of view. */
for (const surface of document.querySelectorAll<HTMLElement>("[data-engine]")) {
  near.observe(surface);
}
