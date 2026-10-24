// Drawing of the inside of a closed broiler house, with animated chickens and lamps.
// coopSVG(h) returns the <svg>; SVG_DEFS (gradients) must be in the page once (layout.js adds it).

export const SVG_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="gCeil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#454b51"/><stop offset="1" stop-color="#737a80"/></linearGradient>
  <linearGradient id="gWallL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6c7479"/><stop offset="1" stop-color="#a3abb0"/></linearGradient>
  <linearGradient id="gWallR" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#6c7479"/><stop offset="1" stop-color="#a3abb0"/></linearGradient>
  <linearGradient id="gFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a7350"/><stop offset="1" stop-color="#cdb07c"/></linearGradient>
  <linearGradient id="gHen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dcd6ca"/></linearGradient>
  <radialGradient id="gGlow"><stop offset="0" stop-color="#fff3c4" stop-opacity=".95"/>
    <stop offset=".35" stop-color="#ffd36b" stop-opacity=".35"/><stop offset="1" stop-color="#ffd36b" stop-opacity="0"/></radialGradient>
</defs></svg>`;

// A point is (xn across, yn top->bottom, t depth); t = 0 is the front opening, t = 1 the back wall with the exhaust fans.
const lerp = (a, b, t) => a + (b - a) * t;
const P = (xn, yn, t) => [lerp(lerp(-60, 360, xn), lerp(115, 185, xn), t), lerp(lerp(-20, 200, yn), lerp(58, 92, yn), t)];
const depth = d => d / (d + 1);          // spacing that shrinks with distance
const S = t => 1 - 0.833 * t;            // size factor at depth t
const pts = (...ps) => ps.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ");
const ln = (a, b, attrs) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" ${attrs}/>`;
const rng = seed => () => (seed = seed * 16807 % 2147483647) / 2147483647;   // same layout on every load

// One broiler facing right with its feet at (0,0): it shuffles sideways and dips its head to peck.
const hen = (begin, dur, dx) => `<g>
  <animateTransform attributeName="transform" type="translate" values="0 0;${dx} 0;${dx} 0;0 0" keyTimes="0;.4;.6;1"
    dur="${(dur * 3).toFixed(1)}s" begin="${begin}s" repeatCount="indefinite"/>
  <ellipse rx="9" ry="1.8" fill="#000" opacity=".22"/>
  <path d="M-8.5-6C-9.5-12-3.5-15 2.5-13.2 6-12 8-9.3 8-6.3 8-2.2 3.5-.3-2-.3-6.8-.3-8.7-3-8.5-6Z" fill="url(#gHen)"/>
  <path d="M-7.5-8.5C-11.5-12.5-12-6.5-8.6-5.2Z" fill="#ece8df"/>
  <path d="M-5-8.2C-2-10.4 3-9.6 4.3-6.4 1-4.4-3.2-4.6-5-8.2Z" fill="#d9d3c7"/>
  <g><animateTransform attributeName="transform" type="rotate" values="0 4.5 -10;0 4.5 -10;38 4.5 -10;0 4.5 -10"
      keyTimes="0;.6;.75;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>
    <path d="M3-9.5C3.5-13 5-16.5 7.4-16.8 9.6-17 10.6-15 10.2-13.2 9.6-11.2 7-9.6 5.5-8.8Z" fill="#f6f4ee"/>
    <path d="M6-17.2q.9-2 1.9-.2q1-1.7 1.9.4q.4 1-.6 1.2Z" fill="#c9302c"/>
    <ellipse cx="9.4" cy="-12.6" rx=".8" ry="1.3" fill="#c9302c"/>
    <path d="M10.1-14.9l2.6.9-2.5.8Z" fill="#dda23a"/><circle cx="8.6" cy="-15.2" r=".6" fill="#1e1e1e"/></g>
  <path d="M-1.5-.6v1.4M2-.6v1.4" stroke="#d6a344" stroke-width=".9"/></g>`;

export function coopSVG(h) {
  const rnd = rng(h * 7919);
  let s = `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice" role="img" aria-label="ภายในโรงเรือนที่ ${h}">
    <polygon fill="url(#gCeil)" points="${pts(P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1))}"/>
    <polygon fill="url(#gWallL)" points="${pts(P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0))}"/>
    <polygon fill="url(#gWallR)" points="${pts(P(1, 0, 0), P(1, 0, 1), P(1, 1, 1), P(1, 1, 0))}"/>
    <polygon fill="url(#gFloor)" points="${pts(P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1))}"/>
    <rect x="115" y="58" width="70" height="34" fill="#9aa2a7"/>
    <polygon fill="#bfd4dc" opacity=".85" points="${pts(P(0, .3, 0), P(0, .3, 1), P(0, .6, 1), P(0, .6, 0))}"/>
    <polygon fill="#bfd4dc" opacity=".85" points="${pts(P(1, .3, 0), P(1, .3, 1), P(1, .6, 1), P(1, .6, 0))}"/>`;
  for (const cx of [134, 166]) s += `<circle cx="${cx}" cy="74" r="9" fill="#2c3135" stroke="#c3c9cd" stroke-width="1"/>
    <path d="M${cx - 7} 74h14M${cx} 67v14M${cx - 5} 69l10 10M${cx + 5} 69l-10 10" stroke="#59626a" stroke-width="1.2"/>`;
  // roof trusses and wall posts
  for (const t of [.5, 1.2, 2, 3.2, 5].map(depth)) {
    const w = `stroke-width="${(2.4 * S(t)).toFixed(2)}"`;
    s += ln(P(0, 0, t), P(1, 0, t), `stroke="#3b4147" ${w}`) +
         ln(P(0, .05, t), P(0, 1, t), `stroke="#5f676d" ${w}`) + ln(P(1, .05, t), P(1, 1, t), `stroke="#5f676d" ${w}`);
  }
  s += ln(P(.5, 0, 0), P(.5, 0, 1), `stroke="#3b4147" stroke-width="1.5"`);
  // two feeder lines with pans, a drinker line between them
  for (const xn of [.3, .7]) {
    s += ln(P(xn, .93, 0), P(xn, .93, 1), `stroke="#a7adb2" stroke-width="1.2"`);
    for (const t of [.15, .45, .85, 1.4, 2.1, 3, 4.3, 6].map(depth)) {
      const [x, y] = P(xn, .985, t), k = S(t);
      s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(8 * k).toFixed(1)}" ry="${(2.6 * k).toFixed(1)}" fill="#d9d5cb" stroke="#8d887e" stroke-width=".5"/>`;
    }
  }
  s += ln(P(.5, .9, 0), P(.5, .9, 1), `stroke="#c9ced2" stroke-width="1"`);
  // chickens, far ones first so near ones overlap them
  const hens = Array.from({ length: 46 }, () => ({ xn: .04 + rnd() * .92, t: depth(.1 + rnd() * 5) }))
    .sort((a, b) => b.t - a.t);
  for (const c of hens) {
    const [x, y] = P(c.xn, 1, c.t), k = 1.35 * S(c.t), flip = rnd() < .5 ? -1 : 1;
    s += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(flip * k).toFixed(3)},${k.toFixed(3)})">` +
         hen(-(rnd() * 4).toFixed(2), (2.4 + rnd() * 2).toFixed(2), (rnd() * 10 - 5).toFixed(1)) + `</g>`;
  }
  // lamps: fixtures sit under the dark shade; their glow and bright bulbs sit above it and show only when lit
  let fixtures = "", lights = "";
  for (const t of [.25, .6, 1.1, 1.8, 3, 5].map(depth)) for (const xn of [.28, .72]) {
    const k = S(t), [x, y] = P(xn, .12, t);
    fixtures += ln(P(xn, 0, t), [x, y], `stroke="#2a2e31" stroke-width="${(.8 * k + .2).toFixed(2)}"`) +
      `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(4 * k + .6).toFixed(1)}" ry="${(1.8 * k + .3).toFixed(1)}" fill="#2f3437"/>`;
    const [fx, fy] = P(xn, 1, t);   // pool of light on the litter under the lamp
    lights += `<ellipse class="glow" cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" rx="${(34 * k).toFixed(1)}" ry="${(9 * k).toFixed(1)}" fill="url(#gGlow)" opacity=".7"/>`;
    lights += `<circle class="glow" cx="${x.toFixed(1)}" cy="${(y + 2 * k).toFixed(1)}" r="${(30 * k + 4).toFixed(1)}" fill="url(#gGlow)"/>
      <circle class="bulb-on" cx="${x.toFixed(1)}" cy="${(y + 1.4 * k).toFixed(1)}" r="${(1.8 * k + .4).toFixed(1)}" fill="#fffbe6"/>`;
  }
  return s + fixtures + `<rect class="shade" width="300" height="170"/><rect class="warm" width="300" height="170"/>` + lights + `</svg>`;
}
