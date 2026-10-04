/**
 * Wilson score confidence interval for a binomial proportion.
 *
 * Used by LOWO and calibration to report win rates with uncertainty bounds.
 */

/**
 * Compute the Wilson score 95% confidence interval.
 * z = 1.96 for 95% confidence.
 */
export function wilsonInterval(
  successes: number,
  total: number,
  z: number = 1.96,
): { lower: number; center: number; upper: number } {
  if (total === 0) return { lower: 0, center: 0, upper: 0 };

  const phat = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (phat + z2 / (2 * total)) / denom;
  const margin =
    (z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total)) / denom;

  return {
    lower: Math.max(0, center - margin),
    center,
    upper: Math.min(1, center + margin),
  };
}
