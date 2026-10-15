// Release the GPU resources of an aircraft view: geometries, materials and the textures that belong to
// it (livery, cockpit screens). Textures marked `userData.shared` (panel bump, light glow) are kept.

export function disposeObject(root) {
  const seen = new Set();
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const value of Object.values(m)) {
        if (value && value.isTexture && !value.userData?.shared) value.dispose();
      }
      m.dispose();
    }
  });
}
