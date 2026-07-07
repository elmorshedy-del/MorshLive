/**
 * render.js — analysis + Arabic critiques → a self-contained, RTL dashboard.
 *
 * Ported from the proven Python `render.py`, flipped to Arabic / RTL and themed
 * to match KoraZero (dark). Static HTML: the analysis JSON is inlined so the page
 * is droppable straight onto the site with no backend at view time.
 */

'use strict';

const { CONFIDENCE_AR, TIER_AR } = require('./critique');

const CSS = `
:root{--bg:#0c0f14;--card:#151a22;--line:#232b36;--ink:#e8edf4;--mut:#8a97a8;
--hi:#34d399;--md:#fbbf24;--lo:#64748b;--lock:#475569;--acc:#5b9cff;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.7;padding:0 5%;
font-family:"Segoe UI",Tahoma,system-ui,sans-serif;direction:rtl;text-align:right}
.wrap{max-width:1040px;margin:0 auto;padding:48px 0 80px}
.kick{letter-spacing:.04em;font-size:12px;color:var(--acc);font-weight:700}
h1{font-size:30px;margin:.25em 0 .1em;font-weight:800}
.score{font-size:40px;font-weight:800;padding:0 .25em}
.sub{color:var(--mut);font-size:14px}
.caps{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 6px}
.cap{font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid var(--line);color:var(--mut)}
.cap.on{color:#04110a;background:var(--hi);border-color:var(--hi)}
.cap.off{border-style:dashed;opacity:.7}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:22px 0 8px}
.metric{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.metric .lab{font-size:11px;letter-spacing:.04em;color:var(--mut)}
.metric .val{font-size:20px;font-weight:700;margin-top:4px}
.callout{background:linear-gradient(180deg,#16202c,#131922);border:1px solid #21425f;border-radius:12px;padding:16px 18px;margin:14px 0 28px}
.callout b{color:var(--acc)}
.sectit{font-size:13px;letter-spacing:.02em;color:var(--mut);margin:34px 0 14px;border-top:1px solid var(--line);padding-top:22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:12px 0}
.card.locked{border-style:dashed;opacity:.82}
.crow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ctitle{font-size:18px;font-weight:800}
.badge{font-size:11px;font-weight:800;padding:3px 10px;border-radius:999px}
.b-high{background:rgba(52,211,153,.16);color:var(--hi)}
.b-medium{background:rgba(251,191,36,.16);color:var(--md)}
.b-low{background:rgba(100,116,139,.2);color:#aab6c6}
.b-locked{background:rgba(71,85,105,.25);color:#9fb0c4}
.tier{font-size:11px;font-weight:700;color:var(--mut);border:1px solid var(--line);padding:2px 8px;border-radius:999px}
.take{color:#cdd6e2;margin:10px 0 12px;font-size:15px}
.ev{display:flex;flex-direction:column;gap:6px}
.chip{background:#0f141b;border:1px solid var(--line);border-right:3px solid var(--acc);border-radius:8px;padding:8px 11px;font-size:13.5px;color:#c6d0dd}
.needs{margin-top:10px;font-size:12px;color:var(--md)}
.foot{margin-top:40px;border-top:1px solid var(--line);padding-top:20px;color:var(--mut);font-size:13px}
.foot code{background:#0f141b;border:1px solid var(--line);padding:1px 6px;border-radius:6px;color:#cdd6e2}
`;

const BADGE = { high: 'b-high', medium: 'b-medium', low: 'b-low', locked: 'b-locked' };
const ALL_CAPS = ['xg', 'shot_xy', 'xy_events', 'tracking'];
const CAP_AR = {
  xg: 'الأهداف المتوقّعة',
  shot_xy: 'إحداثيات التسديد',
  xy_events: 'إحداثيات كل لمسة',
  tracking: 'تتبّع اللاعبين',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function metricsStrip(P) {
  const cells = [];
  for (const [t, s] of Object.entries(P.teamSummary)) {
    if (s.possessionPct != null)
      cells.push(cell(`استحواذ ${t}`, `${esc(s.possessionPct)}٪`));
    if (s.shots != null) cells.push(cell(`تسديدات ${t}`, esc(s.shots)));
    if (s.xgTotal != null) cells.push(cell(`أهداف متوقّعة ${t}`, esc(s.xgTotal)));
  }
  return `<div class="strip">${cells.join('')}</div>`;
}
function cell(lab, val) {
  return `<div class="metric"><div class="lab">${esc(lab)}</div><div class="val">${val}</div></div>`;
}

function callout(P) {
  if (!P.xgByHalf) return '';
  const rows = Object.keys(P.xgByHalf).map(
    (t) => `<b>${esc(t)}</b> ${P.xgByHalf[t].h1} (ش١) · ${P.xgByHalf[t].h2} (ش٢)`
  );
  return `<div class="callout">الأهداف المتوقّعة حسب الشوط &nbsp;—&nbsp; ${rows.join(' &nbsp;|&nbsp; ')}</div>`;
}

function card(c) {
  const locked = c.confidence === 'locked';
  const chips =
    (c.evidence || []).map((e) => `<div class="chip">${esc(e)}</div>`).join('') ||
    '<div class="chip">—</div>';
  const needs =
    c.needs && c.needs.length
      ? `<div class="needs">▲ يصبح أدق مع: ${c.needs.map(esc).join('، ')}</div>`
      : '';
  return (
    `<div class="card${locked ? ' locked' : ''}">` +
    `<div class="crow"><span class="ctitle">${esc(c.titleAr)}</span>` +
    `<span class="badge ${BADGE[c.confidence] || 'b-low'}">ثقة ${esc(CONFIDENCE_AR[c.confidence] || c.confidence)}</span>` +
    `<span class="tier">${esc(TIER_AR[c.tier] || c.tier)}</span></div>` +
    `<div class="take">${esc(c.takeAr)}</div>` +
    `<div class="ev">${chips}</div>${needs}</div>`
  );
}

function renderHtml(A, crits, title) {
  const meta = A.meta;
  const capHtml = ALL_CAPS.map((c) => {
    const on = meta.capabilities.includes(c);
    return `<span class="cap ${on ? 'on' : 'off'}">${esc(CAP_AR[c] || c)}${on ? '' : ' ✕'}</span>`;
  }).join('');

  const body = [];
  body.push(`<div class="kick">${esc(meta.source)} · محرّك تحليل مستقل عن المزوّد</div>`);
  body.push(
    `<h1>${esc(meta.home)} <span class="score">${meta.score[0]}–${meta.score[1]}</span> ${esc(meta.away)}</h1>`
  );
  body.push(`<div class="sub">${esc(meta.competition)} · مباراة ${esc(meta.matchId)}</div>`);
  body.push(`<div class="caps">${capHtml}</div>`);
  body.push(metricsStrip(A.primitives));
  body.push(callout(A.primitives));
  body.push('<div class="sectit">نقد المحلّل — كل رأي مسنودٌ بدليله ودرجة ثقته</div>');
  body.push(crits.map(card).join(''));
  body.push(
    '<div class="foot">' +
      'البيانات: StatsBomb Open Data (للأرشيف) / BALLDONTLIE (للبطولة الجارية). ' +
      'تبديل المصدر يتم بمحوّل واحد؛ منطق التحليل والنقد لا يتغيّر. ' +
      'ما هو <code>مقفل</code> يحتاج تغذية أغنى (إحداثيات/تتبّع) ولا يُختلَق.' +
      '</div>'
  );

  const doc =
    "<!DOCTYPE html><html lang='ar' dir='rtl'><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
    `<title>${esc(title)}</title><style>${CSS}</style></head><body><div class='wrap'>` +
    body.join('') +
    `<script type='application/json' id='analysis'>${esc(
      JSON.stringify({ analysis: A, critiques: crits })
    )}</script>` +
    '</div></body></html>';
  return doc;
}

module.exports = { renderHtml };
