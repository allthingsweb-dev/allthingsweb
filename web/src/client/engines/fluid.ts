import { type Engine, type EngineContext, mosaic } from "../engine.ts";
import {
  bindTexture,
  disposePingPong,
  fullScreen,
  imageTexture,
  type PingPong,
  pass,
  pingPong,
  program,
  rendersFloat,
} from "../gl.ts";

/**
 * fluid: the photos as the surface of a fluid the pointer stirs. A small
 * stable-fluids solver on the GPU (advect, divergence, pressure, project)
 * carries a map of where each point's photo came from; the map relaxes
 * back home, so every swirl heals into the mosaic again.
 */

const header = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform vec2 texel;
`;

const splat = `${header}
uniform sampler2D field;
uniform vec2 point;
uniform vec2 force;
uniform float radius;
uniform float aspect;
void main() {
  vec2 d = uv - point;
  d.x *= aspect;
  float weight = exp(-dot(d, d) / radius);
  color = vec4(texture(field, uv).xy + force * weight, 0.0, 1.0);
}`;

const advect = `${header}
uniform sampler2D velocity;
uniform sampler2D source;
uniform float step;
uniform float keep;
void main() {
  vec2 from = uv - step * texture(velocity, uv).xy * texel;
  color = vec4(texture(source, from).xy * keep, 0.0, 1.0);
}`;

const divergence = `${header}
uniform sampler2D velocity;
void main() {
  float l = texture(velocity, uv - vec2(texel.x, 0.0)).x;
  float r = texture(velocity, uv + vec2(texel.x, 0.0)).x;
  float b = texture(velocity, uv - vec2(0.0, texel.y)).y;
  float t = texture(velocity, uv + vec2(0.0, texel.y)).y;
  color = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}`;

const jacobi = `${header}
uniform sampler2D pressure;
uniform sampler2D divergence;
void main() {
  float l = texture(pressure, uv - vec2(texel.x, 0.0)).x;
  float r = texture(pressure, uv + vec2(texel.x, 0.0)).x;
  float b = texture(pressure, uv - vec2(0.0, texel.y)).x;
  float t = texture(pressure, uv + vec2(0.0, texel.y)).x;
  float d = texture(divergence, uv).x;
  color = vec4((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0);
}`;

const project = `${header}
uniform sampler2D pressure;
uniform sampler2D velocity;
void main() {
  float l = texture(pressure, uv - vec2(texel.x, 0.0)).x;
  float r = texture(pressure, uv + vec2(texel.x, 0.0)).x;
  float b = texture(pressure, uv - vec2(0.0, texel.y)).x;
  float t = texture(pressure, uv + vec2(0.0, texel.y)).x;
  color = vec4(texture(velocity, uv).xy - 0.5 * vec2(r - l, t - b), 0.0, 1.0);
}`;

/** Where each point's photo comes from, carried by the flow and relaxing home. */
const carry = `${header}
uniform sampler2D velocity;
uniform sampler2D map;
uniform float step;
uniform float relax;
void main() {
  vec2 from = uv - step * texture(velocity, uv).xy * texel;
  vec2 source = texture(map, from).xy;
  color = vec4(mix(source, uv, relax), 0.0, 1.0);
}`;

const identity = `${header}
void main() { color = vec4(uv, 0.0, 1.0); }`;

const show = `${header}
uniform sampler2D map;
uniform sampler2D photos;
uniform sampler2D velocity;
void main() {
  vec2 source = texture(map, uv).xy;
  vec3 photo = texture(photos, source).rgb;
  // Where it moves fast, the surface catches a little light.
  float speed = length(texture(velocity, uv).xy);
  photo += vec3(0.06) * smoothstep(4.0, 40.0, speed);
  color = vec4(photo, 1.0);
}`;

export function make({ gl, tiles }: EngineContext): Engine {
  if (!rendersFloat(gl)) throw new Error("No float render targets");
  const draw = fullScreen(gl);
  const programs = {
    splat: program(gl, splat),
    advect: program(gl, advect),
    divergence: program(gl, divergence),
    jacobi: program(gl, jacobi),
    project: program(gl, project),
    carry: program(gl, carry),
    identity: program(gl, identity),
    show: program(gl, show),
  };
  let width = 1;
  let height = 1;
  let canvasWidth = 1;
  let canvasHeight = 1;
  let velocity!: PingPong;
  let pressure!: PingPong;
  let map!: PingPong;
  let divergenceTarget!: PingPong;
  let sized = false;
  let photos = gl.createTexture();
  const splats: Array<{ x: number; y: number; fx: number; fy: number }> = [];

  return {
    resize(cssWidth, cssHeight, scale) {
      width = cssWidth;
      height = cssHeight;
      canvasWidth = Math.round(cssWidth * scale);
      canvasHeight = Math.round(cssHeight * scale);
      const simWidth = Math.max(32, Math.round(cssWidth / 6));
      const simHeight = Math.max(16, Math.round(cssHeight / 6));
      // A resize replaces the targets: the old ones are freed first.
      if (sized) {
        for (const pair of [velocity, pressure, divergenceTarget, map]) {
          disposePingPong(gl, pair);
        }
      }
      sized = true;
      velocity = pingPong(gl, simWidth, simHeight, 2);
      pressure = pingPong(gl, simWidth, simHeight, 1);
      divergenceTarget = pingPong(gl, simWidth, simHeight, 1);
      map = pingPong(gl, simWidth * 2, simHeight * 2, 2);
      pass(gl, map.read, 0, 0, () => {
        gl.useProgram(programs.identity.program);
        draw();
      });
      photos = imageTexture(
        gl,
        mosaic(tiles, cssWidth, cssHeight, scale),
        photos,
      );
    },
    pointer({ x, y, dx, dy }) {
      // A move becomes a push in the flow, in cells per second.
      const cellsX = (dx / width) * velocity.read.width * 60;
      const cellsY = (-dy / height) * velocity.read.height * 60;
      if (Math.abs(cellsX) + Math.abs(cellsY) < 0.01) return;
      splats.push({ x: x / width, y: 1 - y / height, fx: cellsX, fy: cellsY });
    },
    frame(_time, step) {
      const { read } = velocity;
      const texel = [1 / read.width, 1 / read.height] as const;
      const use = (name: keyof typeof programs) => {
        const chosen = programs[name];
        gl.useProgram(chosen.program);
        gl.uniform2f(chosen.uniform("texel"), texel[0], texel[1]);
        return chosen;
      };
      for (const { x, y, fx, fy } of splats.splice(0)) {
        pass(gl, velocity.write, 0, 0, () => {
          const p = use("splat");
          bindTexture(gl, p, "field", velocity.read.texture, 0);
          gl.uniform2f(p.uniform("point"), x, y);
          gl.uniform2f(p.uniform("force"), fx, fy);
          gl.uniform1f(p.uniform("radius"), 0.0025);
          gl.uniform1f(p.uniform("aspect"), width / height);
          draw();
        });
        velocity.swap();
      }
      pass(gl, velocity.write, 0, 0, () => {
        const p = use("advect");
        bindTexture(gl, p, "velocity", velocity.read.texture, 0);
        bindTexture(gl, p, "source", velocity.read.texture, 1);
        gl.uniform1f(p.uniform("step"), step);
        gl.uniform1f(p.uniform("keep"), 0.985);
        draw();
      });
      velocity.swap();
      pass(gl, divergenceTarget.write, 0, 0, () => {
        const p = use("divergence");
        bindTexture(gl, p, "velocity", velocity.read.texture, 0);
        draw();
      });
      divergenceTarget.swap();
      for (let i = 0; i < 18; i++) {
        pass(gl, pressure.write, 0, 0, () => {
          const p = use("jacobi");
          bindTexture(gl, p, "pressure", pressure.read.texture, 0);
          bindTexture(gl, p, "divergence", divergenceTarget.read.texture, 1);
          draw();
        });
        pressure.swap();
      }
      pass(gl, velocity.write, 0, 0, () => {
        const p = use("project");
        bindTexture(gl, p, "pressure", pressure.read.texture, 0);
        bindTexture(gl, p, "velocity", velocity.read.texture, 1);
        draw();
      });
      velocity.swap();
      pass(gl, map.write, 0, 0, () => {
        const p = use("carry");
        bindTexture(gl, p, "velocity", velocity.read.texture, 0);
        bindTexture(gl, p, "map", map.read.texture, 1);
        gl.uniform1f(p.uniform("step"), step);
        gl.uniform1f(p.uniform("relax"), Math.min(1, step * 0.9));
        draw();
      });
      map.swap();
      pass(gl, null, canvasWidth, canvasHeight, () => {
        const p = use("show");
        bindTexture(gl, p, "map", map.read.texture, 0);
        bindTexture(gl, p, "photos", photos, 1);
        bindTexture(gl, p, "velocity", velocity.read.texture, 2);
        draw();
      });
    },
  };
}
