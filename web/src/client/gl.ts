/**
 * The little WebGL2 the lab's engines share: programs, a full-screen
 * triangle, textures from images and canvases, and float render targets
 * that ping-pong. No library: each engine stays a few kilobytes.
 */

export type GL = WebGL2RenderingContext;

/** The vertex shader of every full-screen pass: `uv` from 0 to 1. */
export const fullScreenVertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

function compile(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("No shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "The shader didn't compile");
  }
  return shader;
}

/** A linked program, with its uniforms' locations by name. */
export interface Program {
  readonly program: WebGLProgram;
  readonly uniform: (name: string) => WebGLUniformLocation | null;
}

export function program(
  gl: GL,
  fragment: string,
  vertex: string = fullScreenVertex,
): Program {
  const linked = gl.createProgram();
  gl.attachShader(linked, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(linked, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(linked, 0, "position");
  gl.linkProgram(linked);
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(linked) ?? "The program didn't link");
  }
  const locations = new Map<string, WebGLUniformLocation | null>();
  return {
    program: linked,
    uniform: (name) => {
      if (!locations.has(name)) {
        locations.set(name, gl.getUniformLocation(linked, name));
      }
      return locations.get(name) ?? null;
    },
  };
}

/** One triangle that covers the screen, at attribute 0. */
export function fullScreen(gl: GL): () => void {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return () => {
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };
}

/** A texture of `source`, smoothed and clamped at its edges. */
export function imageTexture(
  gl: GL,
  source: TexImageSource,
  texture: WebGLTexture = gl.createTexture(),
): WebGLTexture {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** A float render target of `channels`, `width` by `height`. */
export interface Target {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
}

const formats = {
  1: ["R16F", "RED"],
  2: ["RG16F", "RG"],
  4: ["RGBA16F", "RGBA"],
} as const;

export function target(
  gl: GL,
  width: number,
  height: number,
  channels: 1 | 2 | 4,
): Target {
  const [internal, format] = formats[channels];
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl[internal],
    width,
    height,
    0,
    gl[format],
    gl.HALF_FLOAT,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width, height };
}

/** Two targets that take turns: read one, write the other, swap. */
export interface PingPong {
  read: Target;
  write: Target;
  swap(): void;
}

export function pingPong(
  gl: GL,
  width: number,
  height: number,
  channels: 1 | 2 | 4,
): PingPong {
  const pair: PingPong = {
    read: target(gl, width, height, channels),
    write: target(gl, width, height, channels),
    swap() {
      [pair.read, pair.write] = [pair.write, pair.read];
    },
  };
  return pair;
}

/** Binds `texture` to unit `unit` as `name` in `program`. */
export function bindTexture(
  gl: GL,
  use: Program,
  name: string,
  texture: WebGLTexture,
  unit: number,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(use.uniform(name), unit);
}

/** Draws into `into` (or the canvas, when null) with the full-screen triangle. */
export function pass(
  gl: GL,
  into: Target | null,
  width: number,
  height: number,
  draw: () => void,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, into === null ? null : into.framebuffer);
  gl.viewport(
    0,
    0,
    into === null ? width : into.width,
    into === null ? height : into.height,
  );
  draw();
}

/** Whether `gl` can render into the half-float targets the simulations use. */
export const rendersFloat = (gl: GL): boolean =>
  gl.getExtension("EXT_color_buffer_float") !== null ||
  gl.getExtension("EXT_color_buffer_half_float") !== null;
