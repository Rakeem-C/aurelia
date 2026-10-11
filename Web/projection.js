// Pure 2:1 isometric projection. Simulation, pathfinding, and fog retain their
// square world coordinates; only the view transforms them into diamond space.
export function projectWorld(x, y) {
  return { x: x - y, y: (x + y) * 0.5 };
}

export function unprojectWorld(x, y) {
  return { x: y + x * 0.5, y: y - x * 0.5 };
}
