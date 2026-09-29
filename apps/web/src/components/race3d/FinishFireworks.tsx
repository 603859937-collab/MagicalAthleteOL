import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial } from "three";

export function FinishFireworks({ place, reducedMotion }: { place: 1 | 2; reducedMotion: boolean }) {
  const { geometry, material } = useMemo(() => {
    const geometry = new BufferGeometry();
    const positions: number[] = [], colors: number[] = [], delays: number[] = [];
    const palette = place === 1 ? ["#ffd35a", "#fff2bd", "#ff7950"] : ["#98ddff", "#e5c4ff", "#ffffff"];
    for (let burst = 0; burst < 3; burst++) {
      for (let i = 0; i < 96; i++) {
        const y = 1 - 2 * (i + .5) / 96;
        const radius = Math.sqrt(1 - y * y);
        const angle = i * 2.399963;
        positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        const color = new Color(palette[i % palette.length]);
        colors.push(color.r, color.g, color.b);
        delays.push(burst * .65);
      }
    }
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    geometry.setAttribute("delay", new BufferAttribute(new Float32Array(delays), 1));
    const material = new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { time: { value: 0 }, reduced: { value: reducedMotion ? 1 : 0 } },
      vertexShader: `
        attribute vec3 color; attribute float delay;
        uniform float time; uniform float reduced;
        varying vec3 tint; varying float fade;
        void main() {
          float t = time - delay;
          float flight = clamp(t / .4, 0., 1.);
          float age = max(0., t - .4);
          float spread = (1. - exp(-age * 2.)) * 1.25;
          vec3 center = vec3(sin(delay * 8.) * .35, 1. + flight * .85, cos(delay * 8.) * .2);
          vec3 p = center + position * spread;
          p.y -= age * age * .45;
          if (reduced > .5) p = vec3(0., 1.6, 0.) + position * .55;
          fade = step(0., t) * (1. - smoothstep(.6, 1.8, age));
          if (reduced > .5) fade = 1. - smoothstep(1., 2., time);
          tint = color;
          vec4 view = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * view;
          gl_PointSize = clamp(65. / -view.z, 2., 12.);
        }`,
      fragmentShader: `varying vec3 tint; varying float fade;
        void main() {
          float r = length(gl_PointCoord - .5) * 2.;
          if (r > 1.) discard;
          gl_FragColor = vec4(tint, pow(1. - r, 1.5) * fade);
        }`,
    });
    return { geometry, material };
  }, [place, reducedMotion]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame((_, delta) => { material.uniforms.time.value += delta; });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
