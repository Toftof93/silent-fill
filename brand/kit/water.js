const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;

float hash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes.xy) / uRes.y;
  float t = mod(uTime, 600.0) * 0.045;

  // slow, warped currents
  vec2 q = vec2(fbm(p * 1.6 + vec2(0.0, t)), fbm(p * 1.6 + vec2(5.2, -t)));
  vec2 r = vec2(fbm(p * 2.2 + 3.0 * q + vec2(1.7, 9.2) + t * 0.6), fbm(p * 2.2 + 3.0 * q + vec2(8.3, 2.8) - t * 0.4));
  float f = fbm(p * 2.0 + 3.5 * r);

  // caustic light lines on the pool floor
  float c = abs(sin(f * 14.0 + t * 6.0));
  float caustic = pow(1.0 - c, 10.0) * smoothstep(0.35, 0.85, f);

  vec3 deep   = vec3(0.012, 0.016, 0.016);
  vec3 teal   = vec3(0.035, 0.20, 0.16);
  vec3 violet = vec3(0.13, 0.08, 0.26);
  vec3 col = mix(deep, teal, smoothstep(0.25, 0.95, f));
  col = mix(col, violet, smoothstep(0.55, 1.0, r.y) * 0.55);
  col += vec3(0.30, 0.62, 0.52) * caustic * 0.55;

  // brighter near the top (the surface), sinking into darkness below
  float depth = smoothstep(0.0, 1.0, uv.y);
  col *= 0.35 + 0.85 * depth;

  // vignette
  float v = smoothstep(1.35, 0.25, length(p * vec2(0.85, 1.1)));
  col *= v;

  gl_FragColor = vec4(col, 1.0);
}`;
function water(canvas, time) {
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, "attribute vec2 a; void main(){ gl_Position = vec4(a,0.,1.); }"));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(p); gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  const l = gl.getAttribLocation(p, "a"); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(p, "uRes"), canvas.width, canvas.height);
  gl.uniform1f(gl.getUniformLocation(p, "uTime"), time);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
