/**
 * critique.js — engine primitives → the six analyst critiques, in Arabic.
 *
 * Ported from the proven Python `critique.py`, kept as STRUCTURED objects so
 * every claim ships with its receipt:
 *   { id, titleAr, takeAr, evidence[], confidence, tier, needs[] }
 *
 *   tier 'data'     -> computed fact (checkable)
 *   tier 'judgment' -> opinion ARGUED from the data (labeled, never disguised)
 *
 * `takeAr` is the deterministic Arabic grounding. `writer.js` may rewrite it
 * into fluent Arabic pundit prose via Claude — but evidence + confidence never
 * change, so the grounding survives the polish. The capability ladder is honest:
 *   full event coords -> goal chain HIGH
 *   shot coords only  -> goal LOCATION medium, flank map medium
 *   no coords         -> goal basic LOW, flank LOCKED
 */

'use strict';

const CONFIDENCE_AR = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة', locked: 'مقفلة' };
const TIER_AR = { data: 'معطيات', judgment: 'تقدير' };

function last(name) {
  return name ? name.trim().split(/\s+/).slice(-1)[0] : null;
}

function sideAr(binKey) {
  return binKey.startsWith('left') ? 'اليسار' : binKey.startsWith('center') ? 'الوسط' : 'اليمين';
}

function buildCritiques(A) {
  const P = A.primitives;
  const hasChain = 'goalChains' in P;
  const hasShotXy = 'chanceFlank' in P;
  const hasXg = 'xgByHalf' in P;
  const hasTrack = 'trackingMetrics' in P;
  const crits = [];

  const summ = (metric) =>
    Object.keys(P.teamSummary)
      .map((t) => `${t} ${P.teamSummary[t][metric]}`)
      .join('، ');

  // 3 — STYLE / أسلوب اللعب
  const styleEv = [`الاستحواذ (نسبة التمرير): ${summ('possessionPct')}`, `التسديدات: ${summ('shots')}`];
  if (hasXg) {
    styleEv.push(
      'الأهداف المتوقّعة بالشوطين — ' +
        Object.keys(P.xgByHalf)
          .map((t) => `${t}: ش1 ${P.xgByHalf[t].h1} / ش2 ${P.xgByHalf[t].h2}`)
          .join('؛ ')
    );
  }
  crits.push({
    id: 'style',
    titleAr: 'أسلوب اللعب',
    takeAr: 'قراءة هويّة كل فريق من نسبة الاستحواذ وحجم التسديد وتوزيع الأهداف المتوقّعة على الشوطين.',
    evidence: styleEv,
    confidence: 'high',
    tier: 'data',
    needs: [],
  });

  // 5 — GOAL CAUSALITY / كيف سُجّل الهدف
  if (hasChain) {
    const ev = P.goalChains.map((c) => {
      const seq = c.sequence
        .slice(-5)
        .map((s) => last(s.player) || s.type)
        .join(' ← ');
      return `د${c.goalMinute} ${c.team}: ${seq}`;
    });
    crits.push({
      id: 'goal',
      titleAr: 'كيف سُجّل الهدف',
      takeAr: 'سلسلة بناء الهدف كاملة، معاد تركيبها من تسلسل اللمسات بإحداثيات الملعب.',
      evidence: ev,
      confidence: 'high',
      tier: 'data',
      needs: [],
    });
  } else if (hasShotXy) {
    const ev = (P.goalLocation || []).map((g) => {
      const zone = g.y == null ? '' : ` من ${sideAr(g.y < 26.7 ? 'left' : g.y < 53.3 ? 'center' : 'right')}`;
      const xgTxt = g.xg != null ? ` (هدف متوقّع ${g.xg})` : '';
      return `د${g.minute} ${g.team}: ${last(g.player)}${zone}${xgTxt}`;
    });
    crits.push({
      id: 'goal',
      titleAr: 'كيف سُجّل الهدف',
      takeAr:
        'موقع التسديدة الحاسمة وقيمتها المتوقّعة — من إحداثيات التسديد. (سلسلة البناء الكاملة تحتاج إحداثيات كل لمسة، غير متاحة مباشرةً.)',
      evidence: ev,
      confidence: 'medium',
      tier: 'data',
      needs: ['إحداثيات كل لمسة لإعادة بناء السلسلة'],
    });
  } else {
    const ev = (P.goalChainsBasic || []).map(
      (g) => `د${g.goalMinute} ${g.team}: ${g.scorer} (صناعة: ${g.assist})`
    );
    crits.push({
      id: 'goal',
      titleAr: 'كيف سُجّل الهدف',
      takeAr: 'المسجّل وصانع الهدف فقط — هذه التغذية بلا إحداثيات.',
      evidence: ev,
      confidence: 'low',
      tier: 'data',
      needs: ['إحداثيات التسديد'],
    });
  }

  // 6 — DEFENSIVE SIDE / الدفاع مكشوف من هذه الجهة
  if (hasShotXy) {
    const lines = Object.keys(P.chanceFlank).map((t) => {
      const b = P.chanceFlank[t];
      const worst = Object.keys(b).reduce((a, k) => (b[k].xg > b[a].xg ? k : a), Object.keys(b)[0]);
      return `الفرص أمام مرمى ${t} تتركّز في ${sideAr(worst)}: ${b[worst].xg} هدف متوقّع من ${b[worst].n} تسديدة`;
    });
    crits.push({
      id: 'defense',
      titleAr: 'دفاع الفريق مكشوف من هذه الجهة',
      takeAr: 'توزيع مصادر الفرص على عرض الملعب (يسار/وسط/يمين) من إحداثيات التسديد.',
      evidence: lines,
      confidence: 'medium',
      tier: 'data',
      needs: ['بيانات تتبّع لعزو الشكل الدفاعي بدقّة'],
    });
  } else {
    crits.push({
      id: 'defense',
      titleAr: 'دفاع الفريق مكشوف من هذه الجهة',
      takeAr: 'مقفل على هذه التغذية — عزو الجهة يحتاج إحداثيات التسديد.',
      evidence: [],
      confidence: 'locked',
      tier: 'data',
      needs: ['إحداثيات التسديد', 'بيانات تتبّع'],
    });
  }

  // 2 — SUB CRITIQUE / هل كان التبديل صائباً
  const subs = P.subs || [];
  const subEv = subs.slice(0, 6).map((s) => `د${s.minute} ${s.team}: ${last(s.off)} ← ${last(s.on)}`);
  if (P.subImpact) {
    for (const [t, v] of Object.entries(P.subImpact)) {
      subEv.push(`تحوّل الأهداف المتوقّعة حول د${v.windowMin} — ${t}: ${v.xgPre15} ← ${v.xgPost15}`);
    }
  }
  crits.push({
    id: 'sub',
    titleAr: 'هل كان التبديل صائباً أم خاطئاً',
    takeAr: hasXg
      ? 'التوقيت مع تحوّل الأهداف المتوقّعة في الدقائق الخمس عشرة قبل التبديل وبعده.'
      : 'التوقيت فقط — تُضاف الأهداف المتوقّعة للحكم على الأثر.',
    evidence: subEv.length ? subEv : ['لا تبديلات مقروءة'],
    confidence: hasXg ? 'medium' : 'low',
    tier: 'judgment',
    needs: hasXg ? [] : ['الأهداف المتوقّعة'],
  });

  // 1 — SUB RECOMMENDATION / من كان يجب تبديله
  crits.push({
    id: 'rec',
    titleAr: 'من كان يجب تبديله',
    takeAr:
      'توصية تحكيمية مبنيّة على تراجع المردود وحالة المباراة. بيانات التتبّع تضيف مؤشّر الإجهاد (المسافة/السرعة) الذي لا تراه بيانات الأحداث.',
    evidence: hasXg
      ? ['مستنتجة من نوافذ معدّل الأهداف المتوقّعة وتركّز الفرص']
      : ['تحتاج الأهداف المتوقّعة/التتبّع لتأسيس توصية قابلة للدفاع'],
    confidence: hasXg ? 'medium' : 'low',
    tier: 'judgment',
    needs: ['تتبّع للإجهاد والحِمل البدني'],
  });

  // 4 — COUNTERFACTUAL / ماذا كان يمكن أن يفعلوا أيضاً
  crits.push({
    id: 'counter',
    titleAr: 'ماذا كان يمكن أن يفعلوا أيضاً',
    takeAr: 'بديل تكتيكي مبنيّ على نقطة الضعف المحدّدة أعلاه.',
    evidence: hasShotXy
      ? ['مبنيّ على نتائج الجهة الأضعف والأهداف المتوقّعة']
      : ['محدود بدون إحداثيات/تتبّع'],
    confidence: 'low',
    tier: 'judgment',
    needs: ['تتبّع للبدائل المكانية'],
  });

  // locked / upsell
  if (!hasTrack) {
    crits.push({
      id: 'locked',
      titleAr: 'يُفتح عند إضافة مصدر تتبّع',
      takeAr: 'أضِف مزوّد تتبّع (SkillCorner) وتُفعَّل هذه المؤشّرات تلقائياً — دون أي تعديل على منطق التحليل.',
      evidence: A.locked,
      confidence: 'locked',
      tier: 'data',
      needs: ['بيانات تتبّع'],
    });
  }

  return crits;
}

module.exports = { buildCritiques, CONFIDENCE_AR, TIER_AR };
