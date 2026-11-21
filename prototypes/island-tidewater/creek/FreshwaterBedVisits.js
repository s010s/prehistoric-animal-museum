// Surveyed approaches. Resolve both eye and target against the same bed that
// swimmers collide with, so the visitor starts above the plants and stones.
export const freshwaterBedStops = [
  {id:'long-lake-bed', region:'lake', title:'潜入长湖草床', p:[2897.08, -1940.27], aim:[2889.82, -1941.77], pitch:-.38, time:10.4,
    note:'沿湖底砾石和水草斑块游动。向湖心下潜，草带逐渐让位于沉积物。'},
  {id:'cirque-lake-bed', region:'highland', title:'冰斗湖水下砾坡', p:[3816.97, -5282.86], aim:[3809.27, -5282.76], pitch:-.275, time:10.9,
    note:'冰斗湖浅坡散落着棱角分明的石块，草丛在间隙生长。向西游是更深的湖盆。'},
  {id:'alluvial-channel-bed', region:'grassland', title:'潜入支流弯道', p:[7855, 4193], aim:[7855, 4186], time:9.8,
    note:'从弯道内侧贴近河床，顺着水流看砾石带和倒伏的长叶。'},
  {id:'marsh-channel-bed', region:'wetland', title:'湿地汊沟水下', p:[5459, 5867], aim:[5462, 5862], time:9.6,
    note:'在浅水里沿草丛之间的泥底穿行。按空格上浮，可以看见汊沟两岸。'},
];

export function freshwaterBedVisits(data) {
  const visits = {};
  for (const stop of freshwaterBedStops) {
    const [x,z] = stop.p, [tx,tz] = stop.aim;
    const [level, edge] = data.field.sample(x,z);
    const depth = level - data.terrain.heightAt(x,z);
    if (edge > 0 || depth < 1.3) continue;
    const eyeBelowSurface = Math.max(.56, depth - (stop.pitch == null ? 1.15 : 1.45));
    const targetY = stop.pitch == null ? data.terrain.heightAt(tx,tz) + .36
      : level - eyeBelowSurface + Math.hypot(tx-x,tz-z) * Math.tan(stop.pitch);
    visits[stop.id] = {...stop, diveLevel:level, eyeBelowSurface, gaze:[tx, targetY, tz]};
  }
  return visits;
}
