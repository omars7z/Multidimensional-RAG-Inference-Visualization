// Mounts its children only while the camera is within `range`, so distant DOM labels don't clutter the view.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Vector3 } from "three";

export function Near({ position, range = 110, children }) {
  const group = useRef();
  const [visible, setVisible] = useState(false);
  const at = useMemo(() => new Vector3(), []);
  const frame = useRef(0);
  useFrame(({ camera }) => {
    if (!group.current || frame.current++ % 8) return;
    group.current.getWorldPosition(at);
    const d = at.distanceTo(camera.position);
    const want = visible ? d < range * 1.12 : d < range;
    if (want !== visible) setVisible(want);
  });
  return <group ref={group} position={position}>{visible && children}</group>;
}
