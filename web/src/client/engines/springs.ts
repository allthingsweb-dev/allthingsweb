import {
  drawCover,
  type Engine,
  type EngineContext,
  type Tile,
} from "../engine.ts";
import { bindTexture, imageTexture, program } from "../gl.ts";

/**
 * springs: every photo a tile on a spring. The pointer pushes the tiles
 * out of its way and drags them along; each one's spring pulls it back to
 * its place, overshooting a little, so the letters scatter and settle. The
 * physics is a few hundred particles on the CPU; the GPU draws them as
 * instanced quads from one atlas of the photos.
 */

const vertex = `#version 300 es
layout(location = 1) in vec4 box;
layout(location = 2) in vec2 turn;
uniform vec2 size;
uniform float columns;
uniform float rows;
out vec2 uv;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 local = (corner - 0.5) * box.zw;
  float c = cos(turn.x);
  float s = sin(turn.x);
  vec2 at = box.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  float cell = turn.y;
  vec2 origin = vec2(mod(cell, columns), floor(cell / columns));
  // The atlas's rows run down the canvas, which the upload turns over.
  uv = vec2((origin.x + corner.x) / columns, 1.0 - (origin.y + corner.y) / rows);
  gl_Position = vec4(at.x / size.x * 2.0 - 1.0, 1.0 - at.y / size.y * 2.0, 0.0, 1.0);
}`;

const fragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D atlas;
void main() { color = texture(atlas, uv); }`;

/** Each photo's cell in the atlas, in pixels. */
const cell = 128;
const atlasColumns = 16;

interface Body {
  readonly homeX: number;
  readonly homeY: number;
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
}

/** The tiles laid out to cover `width`, repeating across when they stop short. */
function cover(tiles: ReadonlyArray<Tile>, width: number): ReadonlyArray<Tile> {
  const reach = Math.max(...tiles.map((tile) => tile.x + tile.width));
  const out: Array<Tile> = [];
  for (let left = 0; left < width; left += reach) {
    for (const tile of tiles) {
      if (left + tile.x < width) out.push({ ...tile, x: left + tile.x });
    }
  }
  return out;
}

export function make({ gl, tiles }: EngineContext): Engine {
  const draw = program(gl, fragment, vertex);
  const images = [...new Set(tiles.map((tile) => tile.image))];
  const rows = Math.ceil(images.length / atlasColumns);
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = atlasColumns * cell;
  atlasCanvas.height = rows * cell;
  const context = atlasCanvas.getContext("2d");
  images.forEach((image, index) => {
    if (context === null) return;
    drawCover(
      context,
      image,
      (index % atlasColumns) * cell,
      Math.floor(index / atlasColumns) * cell,
      cell,
      cell,
    );
  });
  const atlas = imageTexture(gl, atlasCanvas);

  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  let bodies: Array<Body> = [];
  let data = new Float32Array(0);
  let width = 1;
  let height = 1;
  let canvasWidth = 1;
  let canvasHeight = 1;
  let pointer = { x: 0, y: 0, vx: 0, vy: 0, at: -1, pressed: false };
  let now = 0;

  return {
    resize(cssWidth, cssHeight, scale) {
      width = cssWidth;
      height = cssHeight;
      canvasWidth = Math.round(cssWidth * scale);
      canvasHeight = Math.round(cssHeight * scale);
      bodies = cover(tiles, cssWidth).map((tile) => ({
        homeX: tile.x + tile.width / 2,
        homeY: tile.y + tile.height / 2,
        width: tile.width,
        height: tile.height,
        cell: images.indexOf(tile.image),
        x: tile.x + tile.width / 2,
        y: tile.y + tile.height / 2,
        vx: 0,
        vy: 0,
        angle: 0,
        spin: 0,
      }));
      data = new Float32Array(bodies.length * 6);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
      gl.vertexAttribDivisor(2, 1);
      gl.bindVertexArray(null);
    },
    pointer({ x, y, dx, dy, pressed }) {
      pointer = { x, y, vx: dx * 60, vy: dy * 60, at: now, pressed };
    },
    frame(time, step) {
      now = time;
      const active = time - pointer.at < 0.12;
      const reach = pointer.pressed ? 190 : 140;
      for (const body of bodies) {
        let ax = 70 * (body.homeX - body.x) - 9 * body.vx;
        let ay = 70 * (body.homeY - body.y) - 9 * body.vy;
        if (active) {
          const dx = body.x - pointer.x;
          const dy = body.y - pointer.y;
          const distance = Math.hypot(dx, dy) || 1;
          if (distance < reach) {
            const near = 1 - distance / reach;
            const push = near * near * 14000;
            ax += (push * dx) / distance + pointer.vx * near * 5;
            ay += (push * dy) / distance + pointer.vy * near * 5;
            body.spin += (dx * pointer.vy - dy * pointer.vx) * near * 0.00004;
          }
        }
        body.spin += (-40 * body.angle - 6 * body.spin) * step;
        body.angle += body.spin * step;
        body.vx += ax * step;
        body.vy += ay * step;
        body.x += body.vx * step;
        body.y += body.vy * step;
      }
      bodies.forEach((body, index) => {
        data.set(
          [body.x, body.y, body.width, body.height, body.angle, body.cell],
          index * 6,
        );
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvasWidth, canvasHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(draw.program);
      gl.uniform2f(draw.uniform("size"), width, height);
      gl.uniform1f(draw.uniform("columns"), atlasColumns);
      gl.uniform1f(draw.uniform("rows"), rows);
      bindTexture(gl, draw, "atlas", atlas, 0);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, bodies.length);
      gl.bindVertexArray(null);
    },
  };
}
