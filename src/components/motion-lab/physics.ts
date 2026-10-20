export type SpringParameters = {
  stiffness: number;
  damping: number;
  mass: number;
};
/** Ideal unit-step response for the control panel's physical spring diagram. */
export function springResponse(
  time: number,
  { stiffness, damping, mass }: SpringParameters,
) {
  if (time <= 0) return 0;
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (Math.abs(zeta - 1) < 0.0001)
    return 1 - Math.exp(-omega * time) * (1 + omega * time);
  if (zeta < 1) {
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * omega * time) *
        (Math.cos(damped * time) +
          (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(damped * time))
    );
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const a = -omega * (zeta - root);
  const b = -omega * (zeta + root);
  return 1 - (b * Math.exp(a * time) - a * Math.exp(b * time)) / (b - a);
}
export function springCurve(parameters: SpringParameters) {
  return Array.from(
    { length: 81 },
    (_, index) =>
      `${index ? "L" : "M"}${(index * 2.25).toFixed(2)},${(68 - springResponse(index / 40, parameters) * 28).toFixed(2)}`,
  ).join(" ");
}
