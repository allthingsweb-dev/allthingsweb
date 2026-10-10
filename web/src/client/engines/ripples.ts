import { type Engine, type EngineContext, mosaic } from "../engine.ts";
import {
  bindTexture,
  fullScreen,
  imageTexture,
  type PingPong,
  pass,
  pingPong,
  program,
  rendersFloat,
} from "../gl.ts";

/**
 * ripples: the photos under a sheet of water. The pointer drops rings
 * into a height field the GPU steps as a damped wave equation; the photos
 * are seen through it, bent by its slope and lit along its crests.
 */

const header = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform vec2 texel;
`;

/** One step of the wave: height in x, the last step's in y. */
const wave = `${header}
uniform sampler2D field;
uniform vec2 drop;
uniform float strength;
uniform float aspect;
void main() {
  vec2 here = texture(field, uv).xy;
  float l = texture(field, uv - vec2(texel.x, 0.0)).x;
  float r = texture(field, uv + vec2(texel.x, 0.0)).x;
  float b = texture(field, uv - vec2(0.0, texel.y)).x;
  float t = texture(field, uv + vec2(0.0, texel.y)).x;
  float next = ((l + r + b + t) * 0.5 - here.y) * 0.985;
  vec2 d = uv - drop;
  d.x *= aspect;
  next += strength * exp(-dot(d, d) / 0.00035);
  color = vec4(next, here.x, 0.0, 1.0);
}`;

const show = `${header}
uniform sampler2D field;
uniform sampler2D photos;
void main() {
  float l = texture(field, uv - vec2(texel.x, 0.0)).x;
  float r = texture(field, uv + vec2(texel.x, 0.0)).x;
  float b = texture(field, uv - vec2(0.0, texel.y)).x;
  float t = texture(field, uv + vec2(0.0, texel.y)).x;
  vec3 normal = normalize(vec3(l - r, b - t, 0.25));
  vec3 photo = texture(photos, uv + normal.xy * 0.05).rgb;
  // A light low on the left catches the crests.
  float light = pow(max(dot(normal, normalize(vec3(-0.5, 0.6, 1.0))), 0.0), 40.0);
  color = vec4(photo + vec3(light * 0.6), 1.0);
}`;

export function make({ gl, tiles }: EngineContext): Engine {
  if (!rendersFloat(gl)) throw new Error("No float render targets");
  const draw = fullScreen(gl);
  const programs = { wave: program(gl, wave), show: program(gl, show) };
  let width = 1;
  let height = 1;
  let canvasWidth = 1;
  let canvasHeight = 1;
  let field: PingPong;
  let photos = gl.createTexture();
  const drops: Array<{ x: number; y: number; strength: number }> = [];
  let idle = 0;

  const step = (x: number, y: number, strength: number) => {
    pass(gl, field.write, 0, 0, () => {
      const p = programs.wave;
      gl.useProgram(p.program);
      gl.uniform2f(
        p.uniform("texel"),
        1 / field.read.width,
        1 / field.read.height,
      );
      bindTexture(gl, p, "field", field.read.texture, 0);
      gl.uniform2f(p.uniform("drop"), x, y);
      gl.uniform1f(p.uniform("strength"), strength);
      gl.uniform1f(p.uniform("aspect"), width / height);
      draw();
    });
    field.swap();
  };

  return {
    resize(cssWidth, cssHeight, scale) {
      width = cssWidth;
      height = cssHeight;
      canvasWidth = Math.round(cssWidth * scale);
      canvasHeight = Math.round(cssHeight * scale);
      field = pingPong(
        gl,
        Math.max(64, Math.round(cssWidth / 3)),
        Math.max(32, Math.round(cssHeight / 3)),
        2,
      );
      photos = imageTexture(
        gl,
        mosaic(tiles, cssWidth, cssHeight, scale),
        photos,
      );
    },
    pointer({ x, y, dx, dy, pressed }) {
      const speed = Math.hypot(dx, dy);
      if (speed < 1 && !pressed) return;
      drops.push({
        x: x / width,
        y: 1 - y / height,
        strength: pressed ? 1.2 : Math.min(0.8, speed * 0.06),
      });
    },
    frame(time) {
      // Now and then a drop falls by itself, so the water is never still.
      idle += 1;
      if (drops.length === 0 && idle > 90) {
        idle = 0;
        drops.push({
          x: 0.5 + 0.4 * Math.sin(time * 0.7),
          y: 0.5 + 0.3 * Math.cos(time * 0.9),
          strength: 0.5,
        });
      }
      const pending = drops.splice(0);
      for (let i = 0; i < 2; i++) {
        const drop = pending[i];
        step(drop?.x ?? -1, drop?.y ?? -1, drop?.strength ?? 0);
        if (drop !== undefined) idle = 0;
      }
      for (const drop of pending.slice(2)) step(drop.x, drop.y, drop.strength);
      pass(gl, null, canvasWidth, canvasHeight, () => {
        const p = programs.show;
        gl.useProgram(p.program);
        gl.uniform2f(
          p.uniform("texel"),
          1 / field.read.width,
          1 / field.read.height,
        );
        bindTexture(gl, p, "field", field.read.texture, 0);
        bindTexture(gl, p, "photos", photos, 1);
        draw();
      });
    },
  };
}
