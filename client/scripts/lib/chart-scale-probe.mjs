/**
 * Does every bar sit where its own axis says it does?
 *
 * For use with page.evaluate(), alongside OVERFLOW_PROBE. It exists because a
 * chart can be laid out correctly, pass every overflow and colour check, and
 * still lie about its numbers — and nothing else in the harness would notice.
 *
 * THE BUG THIS CAUGHT, and why it is a class rather than a one-off: a column
 * chart drew its bars as a percentage of the whole column box while its
 * gridlines were inset by the height of the x-axis label row. The two were
 * therefore percentages of DIFFERENT boxes, and a value of 27 rendered above the
 * line marked 30. Every individual piece looked right; only measuring one
 * against the other found it. Any chart built from percentage heights inside a
 * box that also holds labels is one refactor away from the same fault.
 *
 * WHAT IT MEASURES: for each chart, the pixel distance from the zero line to the
 * top of each bar, against the distance that bar's STATED value should occupy on
 * the axis the chart itself draws. The stated value is read from the mark's own
 * data attribute, so the chart is checked against its own claim rather than
 * against numbers hard-coded in a test.
 *
 * WHY THE TOLERANCE IS IN PIXELS: a percentage height rounds to a device pixel,
 * so a small error is unavoidable and its size in DATA units depends on the axis
 * scale — 0.5px is 0.1 units on a 30-unit axis and 0.01 on a 300-unit one. In
 * pixels the threshold means the same thing on every chart. Sub-pixel rounding
 * is expected; a wrong denominator is not, and it shows up as whole pixels.
 *
 * A gridline is a 1px rule, so its VALUE is its centre, not its top edge. Taking
 * the edge reports a phantom error of roughly one pixel on every chart.
 *
 * Options let it be pointed at a different markup shape without forking it.
 */
export const CHART_SCALE_PROBE = ({
  chart = '.tp-cols',
  gridline = '.tp-gridline',
  fill = '.tp-colfill',
  // The element carrying the stated value, relative to each fill.
  valueFrom = '.tp-col',
  valueAttribute = 'data-value',
} = {}) => {
  const worst = [];

  for (const plot of document.querySelectorAll(chart)) {
    const lines = [...plot.querySelectorAll(gridline)];
    if (lines.length < 2) continue;

    // The value of a 1px rule is its centre.
    const middle = (el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    const zero = middle(lines[0]);
    const top = middle(lines[lines.length - 1]);
    const topValue = Number(lines[lines.length - 1].textContent.replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(topValue) || topValue === 0) continue;

    const pixelsPerUnit = (zero - top) / topValue;

    for (const bar of plot.querySelectorAll(fill)) {
      const owner = valueFrom ? bar.closest(valueFrom) : bar;
      const stated = Number(String(owner?.getAttribute(valueAttribute) ?? '').replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(stated)) {
        worst.push({ error: 'a bar states no value', attribute: valueAttribute });
        continue;
      }
      const drawnPx = zero - bar.getBoundingClientRect().top;
      const offBy = Math.abs(drawnPx - stated * pixelsPerUnit);
      if (offBy > 1) {
        worst.push({
          stated,
          drawnAs: Math.round((drawnPx / pixelsPerUnit) * 100) / 100,
          offByPx: Math.round(offBy * 100) / 100,
          axisTop: topValue,
        });
      }
    }
  }

  return worst;
};
