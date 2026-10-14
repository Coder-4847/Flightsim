import * as THREE from 'three';

// Lakes (discs at their water level) and river ribbons. Frozen water on the snow map is opaque ice.

function rippleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * 128; const y = Math.random() * 128;
    g.strokeStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},255,0.05)`;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + Math.random() * 14, y + (Math.random() - 0.5) * 3); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildWater(map) {
  const group = new THREE.Group();
  const frozen = map.cfg.biome === 'snow';
  const ripples = rippleTexture();
  const waterColor = map.cfg.biome === 'desert' ? 0x2f9aa0 : 0x2d6a86;
  const water = new THREE.MeshStandardMaterial({
    color: waterColor, roughness: 0.07, metalness: 0.15, transparent: true, opacity: 0.9, bumpMap: ripples, bumpScale: 0.4,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const ice = new THREE.MeshStandardMaterial({ color: 0xd9ebf8, roughness: 0.35, metalness: 0.05, bumpMap: ripples, bumpScale: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const mat = frozen ? ice : water;

  for (const l of map.lakes) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(l.radius * 1.04, 56).rotateX(-Math.PI / 2), mat);
    disc.position.set(l.x, l.level, l.z);
    disc.matrixAutoUpdate = false;
    disc.updateMatrix();
    group.add(disc);
  }
  for (const line of map.riverLines) {
    const pos = [];
    const uv = [];
    const idx = [];
    let along = 0;
    line.points.forEach((p, i) => {
      const a = line.points[Math.max(0, i - 1)];
      const b = line.points[Math.min(line.points.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      const hw = p.w * 1.0;
      pos.push(p.x + nx * hw, p.y + 0.3, p.z + nz * hw, p.x - nx * hw, p.y + 0.3, p.z - nz * hw);
      uv.push(0, along / 60, 1, along / 60);
      if (i) along += Math.hypot(p.x - line.points[i - 1].x, p.z - line.points[i - 1].z);
      if (i < line.points.length - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.material.side = THREE.DoubleSide;
    group.add(m);
  }
  return {
    group,
    update(t) { ripples.offset.set(t * 0.01, t * 0.006); },
    dispose() { group.traverse((o) => o.geometry?.dispose?.()); ripples.dispose(); water.dispose(); ice.dispose(); },
  };
}
