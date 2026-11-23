// The knowledge galaxy: every indexed chunk at its real PCA position, the question as a star,
// and beams to the chunks hybrid search picked. Hover a point to read it.
import { Html, QuadraticBezierLine, Sparkles } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Color, Object3D } from "three";
import { GALAXY, hashHue } from "./layout.js";
import { Near } from "./Near.jsx";
import { TextSprite } from "./TextSprite.jsx";

const toWorld = (xyz) => [GALAXY.center[0] + xyz[0] * GALAXY.radius, GALAXY.center[1] + xyz[1] * GALAXY.radius * 0.7, GALAXY.center[2] + xyz[2] * GALAXY.radius];

function Beam({ from, to, color }) {
  const ref = useRef();
  useFrame((_, dt) => { if (ref.current) ref.current.material.dashOffset -= dt * 2; });
  const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + 3, (from[2] + to[2]) / 2];
  return <QuadraticBezierLine ref={ref} start={from} end={to} mid={mid} color={color} lineWidth={1.6} dashed dashSize={0.8} gapSize={0.5} transparent opacity={0.9} toneMapped={false} />;
}

export function Galaxy({ galaxy, insp, active, quality }) {
  const mesh = useRef();
  const star = useRef();
  const [hover, setHover] = useState(null);
  const points = galaxy?.points ?? [];
  const hot = useMemo(() => new Map((insp?.points ?? []).filter((p) => p.top_k).map((p) => [p.chunk_id, p.fused_rank])), [insp]);
  const world = useMemo(() => points.map((p) => toWorld(p.xyz)), [points]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const o = new Object3D(), c = new Color();
    points.forEach((p, i) => {
      o.position.set(...world[i]);
      o.scale.setScalar(hot.has(p.chunk_id) ? 2.6 : 1);
      o.updateMatrix();
      mesh.current.setMatrixAt(i, o.matrix);
      c.setHSL(hashHue(p.doc_id) / 360, 0.8, hot.has(p.chunk_id) ? 0.75 : 0.55).multiplyScalar(hot.has(p.chunk_id) ? 3 : 1.25);
      mesh.current.setColorAt(i, c);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [points, world, hot]);

  useFrame(({ clock }) => {
    if (star.current) star.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.18 + (active ? 0.4 : 0));
  });

  // One label per document, at the centre of its chunks.
  const labels = useMemo(() => {
    const groups = new Map();
    points.forEach((p, i) => {
      const g = groups.get(p.doc_id) ?? { topic: p.topic, lang: p.lang, sum: [0, 0, 0], n: 0 };
      world[i].forEach((v, k) => { g.sum[k] += v; });
      g.n++;
      groups.set(p.doc_id, g);
    });
    return [...groups].map(([id, g]) => ({ id, topic: g.topic, lang: g.lang, at: g.sum.map((v) => v / g.n) }));
  }, [points, world]);

  const q = insp?.query_xyz ? toWorld(insp.query_xyz) : null;
  const targets = q ? points.map((p, i) => (hot.has(p.chunk_id) ? { i, rank: hot.get(p.chunk_id) } : null)).filter(Boolean) : [];
  const h = hover != null ? points[hover] : null;
  if (!points.length) return null;
  return (
    <group>
      <instancedMesh key={points.length} ref={mesh} args={[undefined, undefined, points.length]}
        onPointerMove={(e) => { e.stopPropagation(); setHover(e.instanceId); }} onPointerOut={() => setHover(null)}>
        <icosahedronGeometry args={[0.3, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <Sparkles count={quality === "sharp" ? 160 : 70} scale={[GALAXY.radius * 2.2, GALAXY.radius * 1.4, GALAXY.radius * 2.2]} position={GALAXY.center} size={2.4} speed={0.25} opacity={0.45} color="#9fb6ff" />
      {labels.map((l) => (
        <Near key={l.id} position={l.at} range={62}>
          <TextSprite title={l.topic} sub={l.lang} color="#c9d6ff" height={1.3} opacity={0.85} />
        </Near>
      ))}
      {q && <>
        <mesh ref={star} position={q}>
          <sphereGeometry args={[1.3, 24, 16]} />
          <meshBasicMaterial color={[6, 6, 6]} toneMapped={false} />
        </mesh>
        <Near position={[q[0], q[1] + 3.4, q[2]]} range={240}><TextSprite title="YOUR QUESTION" color="#ffffff" height={2} /></Near>
        {targets.map(({ i, rank }) => (
          <group key={i}>
            <Beam from={q} to={world[i]} color={rank === 1 ? "#ffffff" : "#7df5d2"} />
            <Near position={[world[i][0], world[i][1] + 2, world[i][2]]} range={150}><TextSprite title={`#${rank}`} color="#2fe6b5" height={1.6} mono /></Near>
          </group>
        ))}
      </>}
      {h && (
        <Html position={world[hover]} distanceFactor={40} zIndexRange={[100, 50]} className="sp-tip">
          <b>{h.chunk_id}</b><span dir="auto">{h.topic} · {h.lang}</span>{hot.has(h.chunk_id) && <em>retrieved #{hot.get(h.chunk_id)}</em>}
        </Html>
      )}
    </group>
  );
}
