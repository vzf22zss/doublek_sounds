// Ondas no grave: a imagem ondula na horizontal, mais forte com o grave (uBands[1]) e no drop (uLow).
// uP[0] = amplitude, uP[1] = frequencia, uP[2] = suavizar (media de 8 amostras, laco com limite constante).
void main() {
  float amp = uP[0] * 0.03 * (0.3 + uBands[1]) * (0.5 + 0.5 * uLow);
  float freq = mix(4.0, 40.0, uP[1]);
  vec2 uv = vUv;
  uv.x += sin(uv.y * freq + uTime * 3.0 + uBeat * 1.5707963) * amp;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    float t = (float(i) - 3.5) / 3.5 * uP[2] * 0.004;
    acc += texture(uInput, uv + vec2(t, 0.0));
  }
  o = acc / 8.0;
}
