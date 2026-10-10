import { type Engine, type EngineContext, mosaic } from "../engine.ts";
import { bindTexture, fullScreen, imageTexture, program } from "../gl.ts";

/**
 * liquid: after localfirstconf.com's 2026 hero, made of the brand. Blobs
 * of light drift over Night and run together like liquid; a trail of them
 * chases the pointer, each following the one before, and merges with
 * them. Inside, they are lenses onto the evenings' photos, bent at the
 * edge; their rims glow from Glow into Lavender. One fragment shader draws
 * it all from a signed distance field: the blobs smoothly unioned.
 */

/** Drawn at most at its CSS size: the field is soft, and every pixel is work. */
export const maxScale = 1;

/** The blobs that chase the pointer. */
const trail = 16;

const fragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D photos;
uniform float time;
uniform float aspect;
uniform vec2 chase[${trail}];

float blob(vec2 p, vec2 center, float radius) { return length(p - center) - radius; }

// A smooth union: blobs near each other run together.
float smoothMin(float a, float b, float k) {
  float h = exp(-k * a) + exp(-k * b);
  return -log(h) / k;
}

float field(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < ${trail}; i++) {
    float radius = 0.13 - float(i) * 0.005;
    d = smoothMin(d, blob(p, chase[i], radius), 9.0);
  }
  vec2 a = vec2(aspect * 0.42 + sin(time * 0.17) * 0.35, cos(time * 0.13) * 0.4);
  vec2 b = vec2(aspect * 0.15 + cos(time * 0.11) * 0.45, sin(time * 0.15) * 0.45);
  vec2 c = vec2(aspect * 0.7 + sin(time * 0.09 + 2.0) * 0.25, sin(time * 0.12 + 1.0) * 0.55);
  d = smoothMin(d, blob(p, a, 0.34), 6.0);
  d = smoothMin(d, blob(p, b, 0.24), 6.0);
  d = smoothMin(d, blob(p, c, 0.2), 6.0);
  return d;
}

const vec3 night = vec3(0.106, 0.090, 0.161);
const vec3 glow = vec3(1.0, 0.416, 0.239);
const vec3 bridge = vec3(0.753, 0.212, 0.173);
const vec3 lavender = vec3(0.855, 0.812, 1.0);

void main() {
  vec2 p = uv * 2.0 - 1.0;
  p.x *= aspect;
  float d = field(p);
  float e = 0.004;
  vec2 normal = normalize(vec2(field(p + vec2(e, 0.0)) - d, field(p + vec2(0.0, e)) - d) + 1e-6);

  float inside = smoothstep(0.012, -0.012, d);
  float depth = clamp(-d / 0.3, 0.0, 1.0);
  float rim = exp(-abs(d) * 55.0);
  float halo = exp(-abs(d) * 11.0);

  // Inside, a lens: the photos, bent toward the edge, a little darker deep in.
  float outward = 1.0 - depth;
  vec2 bent = uv + normal * 0.03 * outward * outward;
  vec3 photo = texture(photos, bent).rgb;
  vec3 lens = photo * mix(1.0, 0.72, depth);

  // Outside, Night, with the faintest trace of the photos under it.
  vec3 ground = night + photo * 0.05;
  ground *= 1.0 - 0.25 * smoothstep(0.6, 1.6, length(uv * 2.0 - 1.0));

  float hue = 0.5 + 0.5 * sin(time * 0.4 + p.x * 1.7 + p.y * 2.3);
  vec3 edge = mix(mix(bridge, glow, smoothstep(0.0, 0.6, hue)), lavender, smoothstep(0.55, 1.0, hue));

  vec3 result = mix(ground, lens, inside);
  result += edge * rim * 1.15;
  result += edge * halo * 0.3 * (1.0 - inside);
  float grain = fract(sin(dot(uv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453);
  result += (grain - 0.5) * 0.025;
  color = vec4(min(result, vec3(1.0)), 1.0);
}`;

export function make({ gl, tiles }: EngineContext): Engine {
  const draw = fullScreen(gl);
  const shade = program(gl, fragment);
  const chase = new Float32Array(trail * 2);
  let width = 1;
  let height = 1;
  let canvasWidth = 1;
  let canvasHeight = 1;
  let photos = gl.createTexture();
  let target = { x: 0, y: 0 };
  let current = { x: 0, y: 0 };
  let moved = false;

  /** The pointer in the field's coordinates: x across by aspect, y up. */
  const toField = (x: number, y: number) => ({
    x: ((x / width) * 2 - 1) * (width / height),
    y: 1 - (y / height) * 2,
  });

  for (let i = 0; i < trail; i++) {
    chase[i * 2] = Math.sin(i * 0.3) * 0.2;
    chase[i * 2 + 1] = Math.cos(i * 0.27) * 0.15;
  }

  return {
    resize(cssWidth, cssHeight, scale) {
      width = cssWidth;
      height = cssHeight;
      canvasWidth = Math.round(cssWidth * scale);
      canvasHeight = Math.round(cssHeight * scale);
      photos = imageTexture(
        gl,
        mosaic(tiles, cssWidth, cssHeight, scale),
        photos,
      );
    },
    pointer({ x, y }) {
      moved = true;
      target = toField(x, y);
    },
    frame(time, step) {
      const aspect = width / height;
      if (!moved) {
        target = {
          // Idle, the trail wanders the right of the field, clear of the text.
          x: aspect * 0.6 + Math.sin(time * 0.23) * aspect * 0.25,
          y: Math.cos(time * 0.19) * 0.45,
        };
      }
      // Each blob follows the one before it; the first follows the pointer.
      const ease = 1 - Math.pow(0.0001, step);
      current = {
        x: current.x + (target.x - current.x) * ease * 0.9,
        y: current.y + (target.y - current.y) * ease * 0.9,
      };
      for (let i = trail - 1; i > 0; i--) {
        const follow = 1 - Math.pow(0.02, step);
        chase[i * 2] =
          (chase[i * 2] ?? 0) +
          ((chase[(i - 1) * 2] ?? 0) - (chase[i * 2] ?? 0)) * follow;
        chase[i * 2 + 1] =
          (chase[i * 2 + 1] ?? 0) +
          ((chase[(i - 1) * 2 + 1] ?? 0) - (chase[i * 2 + 1] ?? 0)) * follow;
      }
      const lead = 1 - Math.pow(0.0005, step);
      chase[0] = (chase[0] ?? 0) + (current.x - (chase[0] ?? 0)) * lead;
      chase[1] = (chase[1] ?? 0) + (current.y - (chase[1] ?? 0)) * lead;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvasWidth, canvasHeight);
      gl.useProgram(shade.program);
      bindTexture(gl, shade, "photos", photos, 0);
      gl.uniform1f(shade.uniform("time"), time);
      gl.uniform1f(shade.uniform("aspect"), aspect);
      gl.uniform2fv(shade.uniform("chase"), chase);
      draw();
    },
  };
}
