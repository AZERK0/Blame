type AnimatedBorderEffect = "agent-response" | "story-progress" | "story-review"

type EffectGeometry = {
  active: boolean
  borderRadius: number
  devicePixelRatio: number
  height: number
  inset: number
  width: number
}

type EffectInitMessage = EffectGeometry & {
  canvas: OffscreenCanvas
  colors: [number, number, number, number][]
  durationMs: number
  effect: AnimatedBorderEffect
  fps: number
  id: number
  type: "init"
}

type EffectMessage =
  | EffectInitMessage
  | { id: number; type: "remove" }
  | ({ id: number; type: "update" } & Partial<EffectGeometry>)

type UniformLocations = {
  boxSize: WebGLUniformLocation | null
  colorA: WebGLUniformLocation | null
  colorB: WebGLUniformLocation | null
  colorC: WebGLUniformLocation | null
  effect: WebGLUniformLocation | null
  phase: WebGLUniformLocation | null
  radius: WebGLUniformLocation | null
  surfaceSize: WebGLUniformLocation | null
}

type EffectRecord = EffectGeometry & {
  canvas: OffscreenCanvas
  colors: [number, number, number, number][]
  durationMs: number
  effect: AnimatedBorderEffect
  fps: number
  gl: WebGLRenderingContext
  geometryDirty: boolean
  nextFrameAt: number
  program: WebGLProgram
  surfaceHeight: number
  surfaceWidth: number
  uniforms: UniformLocations
}

const vertexShaderSource = `
  attribute vec2 position;

  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const fragmentShaderSource = `
  precision mediump float;

  uniform vec2 boxSize;
  uniform vec4 colorA;
  uniform vec4 colorB;
  uniform vec4 colorC;
  uniform float effect;
  uniform float phase;
  uniform float radius;
  uniform vec2 surfaceSize;

  const float PI2 = 6.28318530718;

  float roundedBoxDistance(vec2 point, vec2 halfSize, float cornerRadius) {
    vec2 offset = abs(point) - halfSize + cornerRadius;
    return length(max(offset, 0.0)) + min(max(offset.x, offset.y), 0.0) - cornerRadius;
  }

  vec4 agentRamp(float value) {
    if (value < 0.52778) return vec4(colorA.rgb, 0.0);
    if (value < 0.65278) {
      float amount = (value - 0.52778) / 0.125;
      return vec4(colorA.rgb, mix(0.0, colorA.a * 0.55, amount));
    }
    if (value < 0.79167) {
      float amount = (value - 0.65278) / 0.13889;
      return mix(
        vec4(colorA.rgb, colorA.a * 0.55),
        vec4(colorB.rgb, colorB.a * 0.9),
        amount
      );
    }
    if (value < 0.90278) {
      float amount = (value - 0.79167) / 0.11111;
      return mix(vec4(colorB.rgb, colorB.a * 0.9), colorC, amount);
    }
    float amount = (value - 0.90278) / 0.09722;
    return vec4(colorC.rgb, mix(colorC.a, 0.0, amount));
  }

  vec4 progressRamp(float value) {
    if (value < 0.68056) return vec4(colorA.rgb, 0.0);
    if (value < 0.79167) {
      float amount = (value - 0.68056) / 0.11111;
      return mix(vec4(colorB.rgb, 0.0), colorB, amount);
    }
    if (value < 0.90278) {
      float amount = (value - 0.79167) / 0.11111;
      return mix(colorB, colorA, amount);
    }
    float amount = (value - 0.90278) / 0.09722;
    return vec4(colorA.rgb, mix(colorA.a, 0.0, amount));
  }

  vec4 rotatingBorder(vec2 point, float distanceToBorder) {
    vec2 normalizedPoint = point / max(boxSize * 0.5, vec2(1.0));
    float bearing = atan(normalizedPoint.x, normalizedPoint.y) / PI2;
    float gradientPosition = fract(bearing - phase + 1.0);
    vec4 gradientColor = effect < 0.5
      ? agentRamp(gradientPosition)
      : progressRamp(gradientPosition);
    float stroke = 1.0 - smoothstep(0.35, 1.65, abs(distanceToBorder));
    float outside = max(distanceToBorder, 0.0);
    float nearGlow = exp(-(outside * outside) / 16.0) * 0.28;
    float farGlow = exp(-(outside * outside) / 50.0) * 0.1;
    float coverage = min(1.0, stroke + nearGlow + farGlow);
    return vec4(gradientColor.rgb, gradientColor.a * coverage);
  }

  vec4 reviewGlow(float distanceToBorder) {
    float pulse = 0.5 - 0.5 * cos(phase * PI2);
    float outside = max(distanceToBorder, 0.0);
    float spread = 1.0 - smoothstep(1.5, 2.5, outside);
    float nearGlow = exp(-(outside * outside) / 21.0) * 0.32;
    float farGlow = exp(-(outside * outside) / 58.0) * 0.18;
    float spreadAlpha = spread * colorA.a;
    float nearAlpha = nearGlow * colorB.a;
    float farAlpha = farGlow * colorC.a;
    float combinedAlpha = 1.0 -
      (1.0 - spreadAlpha) *
      (1.0 - nearAlpha) *
      (1.0 - farAlpha);
    vec3 glowColor = mix(
      colorC.rgb,
      colorA.rgb,
      min(1.0, spread + nearGlow * 0.8)
    );
    return vec4(glowColor, combinedAlpha * pulse);
  }

  void main() {
    vec2 point = gl_FragCoord.xy - surfaceSize * 0.5;
    float borderInset = effect > 1.5 ? 0.0 : 1.25;
    float distanceToBorder = roundedBoxDistance(
      point,
      boxSize * 0.5 - borderInset,
      max(0.0, radius - borderInset)
    );
    vec4 result = effect > 1.5
      ? reviewGlow(distanceToBorder)
      : rotatingBorder(point, distanceToBorder);
    gl_FragColor = vec4(result.rgb * result.a, result.a);
  }
`

const effectRecords = new Map<number, EffectRecord>()
let scheduler: ReturnType<typeof setTimeout> | undefined

self.onmessage = ({ data }: MessageEvent<EffectMessage>) => {
  if (data.type === "init") initializeEffect(data)
  if (data.type === "update") updateEffect(data)
  if (data.type === "remove") removeEffect(data.id)
}

function initializeEffect(message: EffectInitMessage) {
  const gl = message.canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    desynchronized: true,
    powerPreference: "low-power",
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  })
  if (!gl) return
  const program = createProgram(gl)
  if (!program) return
  configureGeometry(gl, program)
  const record: EffectRecord = {
    ...message,
    geometryDirty: true,
    gl,
    nextFrameAt: nextFrameTime(performance.now(), message.fps),
    program,
    surfaceHeight: 0,
    surfaceWidth: 0,
    uniforms: uniformLocations(gl, program),
  }
  effectRecords.set(message.id, record)
  scheduleFrames()
}

function updateEffect(message: Extract<EffectMessage, { type: "update" }>) {
  const record = effectRecords.get(message.id)
  if (!record) return
  const wasActive = record.active
  if (
    message.borderRadius !== undefined ||
    message.devicePixelRatio !== undefined ||
    message.height !== undefined ||
    message.inset !== undefined ||
    message.width !== undefined
  ) {
    record.geometryDirty = true
  }
  Object.assign(record, message)
  if (!wasActive && record.active) {
    record.nextFrameAt = nextFrameTime(performance.now(), record.fps)
  }
  scheduleFrames()
}

function removeEffect(id: number) {
  const record = effectRecords.get(id)
  if (!record) return
  record.gl.getExtension("WEBGL_lose_context")?.loseContext()
  effectRecords.delete(id)
  scheduleFrames()
}

function scheduleFrames() {
  if (scheduler) clearTimeout(scheduler)
  scheduler = undefined
  const activeRecords = [...effectRecords.values()].filter(
    (record) => record.active
  )
  if (!activeRecords.length) return
  const now = performance.now()
  const nextFrameAt = Math.min(
    ...activeRecords.map((record) => record.nextFrameAt)
  )
  scheduler = setTimeout(renderDueFrames, Math.max(0, nextFrameAt - now))
}

function renderDueFrames() {
  scheduler = undefined
  const now = performance.now()
  for (const record of effectRecords.values()) {
    if (!record.active || record.nextFrameAt > now + 1) continue
    renderEffect(record, now)
    record.nextFrameAt = nextFrameTime(now, record.fps)
  }
  scheduleFrames()
}

function nextFrameTime(now: number, fps: number) {
  const interval = 1_000 / fps
  return (Math.floor(now / interval) + 1) * interval
}

function renderEffect(record: EffectRecord, now: number) {
  const {
    canvas,
    colors,
    devicePixelRatio,
    durationMs,
    effect,
    gl,
    height,
    inset,
    program,
    uniforms,
    width,
  } = record
  const surfaceWidth = Math.max(
    1,
    Math.round((width + inset * 2) * devicePixelRatio)
  )
  const surfaceHeight = Math.max(
    1,
    Math.round((height + inset * 2) * devicePixelRatio)
  )
  if (
    record.geometryDirty ||
    record.surfaceWidth !== surfaceWidth ||
    record.surfaceHeight !== surfaceHeight
  ) {
    if (canvas.width !== surfaceWidth) canvas.width = surfaceWidth
    if (canvas.height !== surfaceHeight) canvas.height = surfaceHeight
    record.surfaceWidth = surfaceWidth
    record.surfaceHeight = surfaceHeight
    gl.viewport(0, 0, surfaceWidth, surfaceHeight)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(program)
    gl.uniform2f(
      uniforms.boxSize,
      width * devicePixelRatio,
      height * devicePixelRatio
    )
    setUniformColor(gl, uniforms.colorA, colors[0])
    setUniformColor(gl, uniforms.colorB, colors[1] ?? colors[0])
    setUniformColor(gl, uniforms.colorC, colors[2] ?? colors[0])
    gl.uniform1f(uniforms.effect, effectIndex(effect))
    gl.uniform1f(uniforms.radius, record.borderRadius * devicePixelRatio)
    gl.uniform2f(uniforms.surfaceSize, surfaceWidth, surfaceHeight)
    record.geometryDirty = false
  }
  gl.uniform1f(uniforms.phase, (now % durationMs) / durationMs)
  drawBorderStrips(
    gl,
    surfaceWidth,
    surfaceHeight,
    Math.ceil((inset + record.borderRadius + 3) * devicePixelRatio)
  )
}

function drawBorderStrips(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
  requestedThickness: number
) {
  const thickness = Math.max(
    1,
    Math.min(requestedThickness, Math.ceil(Math.min(width, height) / 2))
  )
  if (thickness * 2 >= Math.min(width, height) * 0.75) {
    gl.disable(gl.SCISSOR_TEST)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    return
  }

  gl.enable(gl.SCISSOR_TEST)
  drawScissoredQuad(gl, 0, 0, width, thickness)
  drawScissoredQuad(gl, 0, height - thickness, width, thickness)

  const middleHeight = height - thickness * 2
  drawScissoredQuad(gl, 0, thickness, thickness, middleHeight)
  drawScissoredQuad(gl, width - thickness, thickness, thickness, middleHeight)
  gl.disable(gl.SCISSOR_TEST)
}

function drawScissoredQuad(
  gl: WebGLRenderingContext,
  x: number,
  y: number,
  width: number,
  height: number
) {
  gl.scissor(x, y, width, height)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
}

function createProgram(gl: WebGLRenderingContext) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource
  )
  if (!vertexShader || !fragmentShader) return undefined
  const program = gl.createProgram()
  if (!program) return undefined
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program
  gl.deleteProgram(program)
  return undefined
}

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return undefined
}

function configureGeometry(gl: WebGLRenderingContext, program: WebGLProgram) {
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  )
  const location = gl.getAttribLocation(program, "position")
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
}

function uniformLocations(
  gl: WebGLRenderingContext,
  program: WebGLProgram
): UniformLocations {
  return {
    boxSize: gl.getUniformLocation(program, "boxSize"),
    colorA: gl.getUniformLocation(program, "colorA"),
    colorB: gl.getUniformLocation(program, "colorB"),
    colorC: gl.getUniformLocation(program, "colorC"),
    effect: gl.getUniformLocation(program, "effect"),
    phase: gl.getUniformLocation(program, "phase"),
    radius: gl.getUniformLocation(program, "radius"),
    surfaceSize: gl.getUniformLocation(program, "surfaceSize"),
  }
}

function setUniformColor(
  gl: WebGLRenderingContext,
  location: WebGLUniformLocation | null,
  color: [number, number, number, number] | undefined
) {
  const [red = 0, green = 0, blue = 0, alpha = 0] = color ?? []
  gl.uniform4f(location, red, green, blue, alpha)
}

function effectIndex(effect: AnimatedBorderEffect) {
  if (effect === "story-progress") return 1
  if (effect === "story-review") return 2
  return 0
}

export {}
