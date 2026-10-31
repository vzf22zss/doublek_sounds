// RGB split no kick: separa vermelho e azul para os lados a cada batida.
// uP[0] = forca, uP[1] = angulo (0..1 = uma volta). uKick vai a 1 na batida e cai depois.
void main() {
  float amt = uP[0] * (0.2 + 0.8 * uKick) * 0.02;
  float ang = uP[1] * 6.2831853;
  vec2 d = vec2(cos(ang), sin(ang)) * amt;
  vec4 c = texture(uInput, vUv);
  float r = texture(uInput, vUv + d).r;
  float b = texture(uInput, vUv - d).b;
  o = vec4(r, c.g, b, c.a);
}
