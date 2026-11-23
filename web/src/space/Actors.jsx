// You (a hovering probe, seen from behind in third person) and the data packet that flies each stage's route.
import { Trail } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CatmullRomCurve3, Vector3 } from "three";
import { STAGES } from "../components/Journey3D.jsx";
import { routePoints } from "./layout.js";

const UP = new Vector3(0, 1, 0);
const damp = (k, dt) => 1 - Math.exp(-k * dt);

/** Keyboard + drag-to-look input; the bus carries position and yaw to the HUD and the minimap. */
export function Player({ bus }) {
  const body = useRef();
  const ring = useRef();
  const shadow = useRef();
  const { camera, gl } = useThree();
  const vel = useMemo(() => new Vector3(), []);
  const tmp = useMemo(() => ({ want: new Vector3(), fwd: new Vector3(), right: new Vector3(), cam: new Vector3(), look: new Vector3() }), []);

  useEffect(() => {
    const el = gl.domElement;
    let drag = null;
    const down = (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); };
    const move = (e) => {
      if (!drag) return;
      bus.yawT = (bus.yawT ?? bus.yaw) - (e.clientX - drag.x) * 0.0055;
      bus.pitchT = Math.max(-0.15, Math.min(1.25, (bus.pitchT ?? bus.pitch) + (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => { drag = null; };
    const wheel = (e) => { e.preventDefault(); bus.distT = Math.max(5, Math.min(90, (bus.distT ?? bus.dist) * (1 + Math.sign(e.deltaY) * 0.12))); };
    const key = (v) => (e) => {
      if (e.target.closest?.("input, textarea")) return;
      if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
      bus.keys[e.code] = v;
      if (v && ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyE", "KeyQ"].includes(e.code)) { bus.ride = false; bus.onManual?.(); }
    };
    const kd = key(true), ku = key(false);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
    };
  }, [bus, gl]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    // Look and zoom ease toward their targets, so dragging and scrolling feel smooth at any frame rate.
    bus.yawT ??= bus.yaw; bus.pitchT ??= bus.pitch; bus.distT ??= bus.dist;
    bus.yaw += (bus.yawT - bus.yaw) * damp(16, dt);
    bus.pitch += (bus.pitchT - bus.pitch) * damp(16, dt);
    bus.dist += (bus.distT - bus.dist) * damp(10, dt);
    bus.frames = (bus.frames ?? 0) + 1;
    bus.clock = (bus.clock ?? 0) + rawDt;
    if (bus.clock >= 0.5) { bus.fps = Math.round(bus.frames / bus.clock); bus.frames = 0; bus.clock = 0; }
    const k = bus.keys, pos = bus.avatar;
    const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const u = (k.Space || k.KeyE ? 1 : 0) - (k.KeyQ || k.KeyC ? 1 : 0);
    tmp.fwd.set(-Math.sin(bus.yaw), 0, -Math.cos(bus.yaw));
    tmp.right.set(Math.cos(bus.yaw), 0, -Math.sin(bus.yaw));

    if (bus.flight) { // teleport: an eased arc to the target
      const fl = bus.flight;
      fl.t = Math.min(1, fl.t + dt / fl.dur);
      const e = fl.t < 0.5 ? 4 * fl.t ** 3 : 1 - (-2 * fl.t + 2) ** 3 / 2;
      pos.lerpVectors(fl.from, fl.to, e).y += Math.sin(Math.PI * e) * fl.lift;
      if (fl.t >= 1) bus.flight = null;
      vel.set(0, 0, 0);
    } else if (bus.ride) { // ride along behind the packet
      tmp.want.copy(bus.packet).addScaledVector(UP, 1.5);
      pos.lerp(tmp.want, damp(5, dt));
      vel.set(0, 0, 0);
    } else {
      tmp.want.set(0, 0, 0).addScaledVector(tmp.fwd, f).addScaledVector(tmp.right, s).addScaledVector(UP, u);
      if (tmp.want.lengthSq() > 0) tmp.want.normalize().multiplyScalar(k.ShiftLeft || k.ShiftRight ? 60 : 22);
      vel.lerp(tmp.want, damp(6, dt));
      pos.addScaledVector(vel, dt);
    }
    pos.y = Math.max(1.4, Math.min(160, pos.y));

    if (body.current) {
      body.current.position.copy(pos);
      body.current.position.y += Math.sin(clock.elapsedTime * 2.2) * 0.15;
      if (vel.lengthSq() > 1) body.current.rotation.y = Math.atan2(-vel.x, -vel.z);
    }
    if (ring.current) { ring.current.rotation.x = Math.PI / 2 + Math.sin(clock.elapsedTime) * 0.25; ring.current.rotation.z += dt * 2; }
    if (shadow.current) { shadow.current.position.set(pos.x, 0.04, pos.z); shadow.current.scale.setScalar(Math.max(0.3, 1.6 - pos.y * 0.03)); }

    const cp = Math.cos(bus.pitch);
    tmp.cam.set(Math.sin(bus.yaw) * cp, Math.sin(bus.pitch), Math.cos(bus.yaw) * cp).multiplyScalar(bus.dist).add(pos);
    tmp.cam.y = Math.max(0.8, tmp.cam.y);
    camera.position.lerp(tmp.cam, damp(bus.flight ? 4 : 7, dt));
    tmp.look.copy(pos).addScaledVector(UP, 1.6);
    camera.lookAt(tmp.look);
  });

  return (
    <>
      <group ref={body}>
        <mesh><sphereGeometry args={[0.7, 32, 32]} /><meshBasicMaterial color={[0.6, 3.2, 3.6]} toneMapped={false} /></mesh>
        <mesh ref={ring}><torusGeometry args={[1.35, 0.07, 10, 64]} /><meshBasicMaterial color={[0.4, 2.2, 3]} toneMapped={false} /></mesh>
        <mesh position={[0, 0, -0.9]}><coneGeometry args={[0.28, 0.8, 16]} /><meshBasicMaterial color={[2.4, 2.4, 2.8]} toneMapped={false} /></mesh>
      </group>
      <mesh ref={shadow} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.9, 32]} />
        <meshBasicMaterial color={[0.2, 0.9, 1]} toneMapped={false} transparent opacity={0.18} />
      </mesh>
    </>
  );
}

const RUNS = 2; // flights per stage
const SPEED = 30; // metres per second along the route
const HOLD = 0.7; // seconds resting at the destination after each flight

/** A comet that flies the current stage's route twice, then rests at the end and calls onDone.
 *  Skipped stages (after a refusal) have none. */
export function Packet({ stage, bus, hidden, onDone }) {
  const mesh = useRef();
  const t = useRef(0);
  const hold = useRef(0);
  const finished = useRef(false);
  const [run, setRun] = useState(0); // a new run remounts the trail, so it doesn't streak back to the start
  const curve = useMemo(() => {
    const pts = routePoints(STAGES[stage].path).map((p) => new Vector3(...p));
    return pts.length > 1 ? new CatmullRomCurve3(pts, false, "catmullrom", 0.3) : null;
  }, [stage]);
  const length = curve ? curve.getLength() : 1;
  useEffect(() => { t.current = 0; hold.current = 0; finished.current = false; bus.packetDone = false; setRun(0); }, [stage, bus]);
  useFrame((_, rawDt) => {
    if (!curve || !mesh.current) return;
    const dt = Math.min(rawDt, 0.05);
    if (!finished.current) {
      if (t.current < 1) t.current = Math.min(1, t.current + dt * Math.max(0.2, SPEED / length));
      else if ((hold.current += dt) >= HOLD) {
        hold.current = 0;
        if (run + 1 < RUNS) { t.current = 0; setRun(run + 1); }
        else { finished.current = true; bus.packetDone = true; onDone?.(); }
      }
    }
    curve.getPointAt(t.current, mesh.current.position);
    bus.packet.copy(mesh.current.position);
  });
  if (!curve || hidden) return null;
  return (
    <Trail key={`${stage}-${run}`} width={2.4} length={10} color="#bff6ff" attenuation={(x) => x * x}>
      <mesh ref={mesh}>
        <sphereGeometry args={[0.65, 24, 24]} />
        <meshBasicMaterial color={[5, 6, 7]} toneMapped={false} />
      </mesh>
    </Trail>
  );
}
