/**
 * Where a monthly chart starts: after the first 5% of the total, when that cuts more than a year.
 * A long quiet lead-in or a gap in the history would otherwise take most of the width.
 */
export function leadInEnd(totals: number[]): number {
  const total = totals.reduce((a, b) => a + b, 0);
  let before = 0;
  let start = 0;
  while (start < totals.length - 1 && before + totals[start]! <= total * 0.05) before += totals[start++]!;
  return start > 12 ? start : 0;
}
