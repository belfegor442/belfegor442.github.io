// Player skin catalogue. Every skin is fitted to the same world height so the
// gameplay scale (nametags at 44, FP eye 24.5, seat anchors) stays valid no
// matter which model is worn.
//
// rotX/yaw reorient the model after load (Sketchfab exports often ship the
// character lying on its back or facing the wrong way); `height` overrides the
// auto-fit target when a skin should read bigger/smaller than classic steve.
//
// NOTE: Assets/player/player.skin.glb is a rigged export whose rest pose is
// broken (leg verts sit ~200 units above the hips and no transform in the
// file brings them down — any spec-compliant renderer shows detached legs).
// It is intentionally absent until the export is fixed or animated.

export const DEFAULT_SKIN = 'classic';
export const TARGET_H = 32;

export const SKINS = [
  { id: 'classic', name: 'CLASSIC', url: './Assets/gbl/Player/steve.skin.glb' },
  { id: 'homer', name: 'HOMER', url: './Assets/player/homerball.glb', height: 26 },
  { id: 'franco', name: 'FRANCO', url: './Assets/player/franco.glb' },
  { id: 'yahu', name: 'BIG YAHU', url: './Assets/player/big.yahu.glb', height: 36 }
];

export const SKIN_BY_ID = new Map(SKINS.map(s => [s.id, s]));

export function normalizeSkin(id) {
  return SKIN_BY_ID.has(id) ? id : DEFAULT_SKIN;
}
