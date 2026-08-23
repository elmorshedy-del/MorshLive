/* KoraZero editorial layer — native Arabic/English copy, concise FAQ, and
 * translations for conditional football UI that used to leak hard-coded Arabic. */
(function (global) {
  "use strict";

  const i18n = global.I18N;
  if (!i18n) return;

  const COPY = {
    ar: {
      "nav.home": "الرئيسية",
      "nav.matches": "مباريات اليوم",
      "nav.saved": "المحفوظة",
      "nav.faq": "الأسئلة الشائعة",
      "nav.live": "البث المباشر",
      "nav.tournament": "أرشيف الملخصات",
      "notice.seasonKicker": "تحديث الموسم",
      "notice.seasonTitle": "نجهّز تغطية الموسم الجديد",
      "notice.seasonBody": "نعمل حالياً على تجهيز مصادر البث للموسم الجديد وتحسين استقرار المشاهدة. ستظهر المباريات المتاحة تلقائياً فور جاهزيتها.",
      "archive.kicker": "أرشيف 2026",
      "archive.title": "كأس العالم 2026 — 104 مباراة",
      "archive.lede": "النتائج والملخصات والأهداف من جميع مباريات البطولة، محفوظة في أرشيف واحد.",
      "archive.cta": "استعرض أرشيف كأس العالم",
      "bookmark.save": "أضف للمفضلة",
      "bookmark.aria": "إضافة كورة زيرو إلى المفضلة",
      "tv.eyebrow": "للشاشات الكبيرة · بدون تطبيق",
      "tv.title": "كورة زيرو على التلفزيون",
      "tv.lede": "فعّل وضع التلفزيون لواجهة أكبر وأسهل من مسافة المشاهدة، مع تنقّل كامل بأزرار الريموت ومن دون تثبيت تطبيق.",
      "tv.feat1title": "واجهة أوضح على الشاشة الكبيرة",
      "tv.feat1desc": "يكبّر النص والأزرار تلقائياً لتبقى المباريات والمعلومات سهلة القراءة من مسافة.",
      "tv.feat2title": "تنقّل كامل بالريموت",
      "tv.feat2desc": "استخدم الأسهم للتنقّل بين المباريات والمشغّلات، ثم اضغط OK للاختيار.",
      "tv.feat3title": "متوافق مع متصفحات التلفزيون",
      "tv.feat3desc": "يعمل مع متصفحات Samsung وLG وFire TV وApple TV، ويمكن تفعيله يدوياً في أي وقت.",
      "tv.feat4title": "نفس تجربة المشاهدة",
      "tv.feat4desc": "الجودة والقناة والمعلّق ومصدر البث المتاح نفسه، لكن بواجهة مصممة للشاشة الكبيرة.",
      "tv.statusOff": "وضع التلفزيون غير مفعّل على هذا الجهاز",
      "tv.statusOn": "وضع التلفزيون مفعّل — استخدم أسهم الريموت للتنقّل",
      "tv.remoteHint": "الأسهم للتنقّل · OK للاختيار",
      "tv.stepsTitle": "ابدأ على التلفزيون في 3 خطوات",
      "tv.step1": "افتح korazero.com من متصفح التلفزيون الذكي، أو أرسل الرابط من هاتفك.",
      "tv.step2": "فعّل «وضع التلفزيون» من أعلى الصفحة. ويمكن إضافة <code>?tv=1</code> إلى الرابط لتفعيله تلقائياً.",
      "tv.step3": "اختر المباراة واضغط OK على الريموت لفتح المشاهدة.",
      "hero.quickSettings": "إعدادات المشاهدة",
      "hero.tvHintPrefix": "على شاشة كبيرة؟",
      "hero.tvHintLink": "فعّل وضع التلفزيون",
      "wc.archiveBadge": "104 مباراة · أرشيف كامل",
      "hero.noAds": "واجهة نظيفة بدون إعلانات مزعجة",
      "seo.title": "مباريات اليوم بث مباشر ونتائج مباشرة | كورة زيرو",
      "seo.description": "تابع مباريات اليوم على كورة زيرو: بث مباشر عند توفره، مواعيد ونتائج حية، التشكيلات والإحصائيات والقنوات والمعلّقون للدوري الإنجليزي والدوري الإسباني ودوري أبطال أوروبا.",
      "seo.ogTitle": "مباريات اليوم بث مباشر ونتائج مباشرة | كورة زيرو",
      "seo.ogDescription": "مباريات اليوم في مكان واحد: بث مباشر عند توفره، نتائج حية، مواعيد، تشكيلات، إحصائيات، قنوات ومعلّقون.",
      "seo.twitterDescription": "مباريات اليوم على كورة زيرو — مواعيد ونتائج مباشرة وتغطية المباراة والبث المتاح.",
      "seo.keywords": "مباريات اليوم, بث مباشر, نتائج مباشرة, جدول المباريات, كورة اون لاين, القنوات الناقلة, معلق المباراة, الدوري الإنجليزي, الدوري الإسباني, دوري أبطال أوروبا, كورة زيرو",
      "seo.slogan": "مباريات اليوم والتغطية الحية في مكان واحد",
      "seo.keywordsAria": "أهم خدمات كورة زيرو",
      "seo.kw1": "مباريات اليوم",
      "seo.kw2": "بث مباشر",
      "seo.kw3": "نتائج مباشرة",
      "seo.kw4": "تشكيلات وإحصائيات",
      "seo.kw5": "قنوات ومعلّقون",
      "seo.kw6": "بتوقيت الرياض وET",
      "hero.title": "مباريات اليوم بث مباشر — <span>الجداول والنتائج والتغطية الحية</span>",
      "hero.lede": "تابع مباريات اليوم من مكان واحد: المواعيد، النتائج الحية، التشكيلات، الإحصائيات، القنوات والمعلّقون، مع الوصول إلى البث المتاح لكل مباراة. تغطية مركزة للدوري الإنجليزي والدوري الإسباني ودوري أبطال أوروبا، بتوقيت الرياض والتوقيت الشرقي الأمريكي.",
      "hero.usp1": "واجهة بدون إعلانات مزعجة",
      "hero.usp2": "نتائج لحظة بلحظة",
      "hero.usp3": "تشكيلات وإحصائيات",
      "hero.usp4": "المصدر المتاح يُحدَّد تلقائياً",
      "hero.ctaLive": "شاهد البث المتاح",
      "hero.seasonTitle": "كل تفاصيل المباراة في مكان واحد",
      "hero.seasonLede": "قبل البداية تظهر التشكيلة الرسمية، وخلال المباراة تتحدث النتيجة والدقيقة والمسجلون والإحصائيات تلقائياً.",
      "hero.ctaArchive": "أرشيف كأس العالم 2026",
      "hero.ctaArchiveSub": "104 مباراة · أهداف وملخصات · تعليق عربي",
      "hero.ctaMatches": "عرض مباريات اليوم",
      "season.liveCoverage": "تغطية مباشرة · موسم 2026/27",
      "season.title": "أهم مباريات أوروبا، لحظة بلحظة",
      "season.lede": "المواعيد والنتائج والتشكيلات والأهداف والإحصائيات تتحدث طوال المباراة.",
      "season.openSchedule": "عرض مباريات اليوم",
      "season.worldCupArchive": "أرشيف كأس العالم 2026 · 104 مباراة",
      "stage.title": "ليالي أوروبا مباشرة",
      "stage.lede": "الدوري الإنجليزي · الدوري الإسباني · دوري أبطال أوروبا — مواعيد ونتائج وتشكيلات وإحصائيات لحظة بلحظة.",
      "stage.railTitle": "أهم البطولات الأوروبية",
      "matches.title": "مباريات اليوم",
      "matches.lede": "اختر البطولة وتابع مباريات اليوم وما بعدها. النتائج وحالة المباراة تتحدث تلقائياً.",
      "faq.title": "معلومات سريعة",
      "faq.q1": "ماذا أجد في صفحة المباراة؟",
      "faq.a1": "الموعد والنتيجة الحية والتشكيلة والإحصائيات والأهداف، إضافة إلى القناة والمعلّق ورابط المشاهدة عندما يكون البث متاحاً.",
      "faq.q2": "ما البطولات التي يغطيها كورة زيرو؟",
      "faq.a2": "يركز كورة زيرو على الدوري الإنجليزي الممتاز والدوري الإسباني ودوري أبطال أوروبا، مع جداول ونتائج وتفاصيل مباشرة للمباريات المتاحة.",
      "faq.q3": "كيف تُعرض مواعيد المباريات؟",
      "faq.a3": "تظهر المواعيد بتوقيت الرياض والتوقيت الشرقي الأمريكي (ET)، لتكون ساعة البداية واضحة للمشاهدين في المنطقة العربية والولايات المتحدة.",
      "footer.about": "كورة زيرو يجمع مباريات اليوم والمواعيد والنتائج الحية والتشكيلات والإحصائيات والقنوات والمعلّقين، مع الوصول إلى البث المتاح للمباراة من واجهة واحدة.",
      "footer.disclaimer": "قد تعتمد بعض المشاهدات على مصادر خارجية. حقوق البث والعلامات التجارية تعود إلى أصحابها، وتُطبق القواعد المعمول بها في بلدك.",
      "footer.bottom": "© 2026 KoraZero · مباريات اليوم، ببساطة.",
      "footer.bottomShort": "© 2026 KoraZero",
      "tournament.title": "أرشيف كأس العالم 2026",
      "tournament.lede": "جميع مباريات البطولة في أرشيف واحد: النتائج، الأهداف، أبرز اللقطات والملخصات المتاحة.",
      "tournament.highlightTitle": "ملخص المباراة",
      "tournament.goalsTitle": "الأهداف",
      "tournament.goalsHint": "الأهداف فقط · نحو 3–4 دقائق",
      "tournament.fullHint": "أبرز أحداث المباراة · نحو 10 دقائق",
      "tournament.notableClipsTitle": "أبرز اللقطات",
      "tournament.memesTitle": "الأكثر تداولاً على X",
      "tournament.noHighlight": "لم يتوفر ملخص فيديو لهذه المباراة بعد.",
      "tournament.noMemes": "لا توجد منشورات بارزة مرتبطة بهذه المباراة حالياً.",
      "tournament.empty": "لا توجد مباريات في هذه المرحلة حتى الآن.",
      "tournament.loadError": "تعذّر تحميل أرشيف البطولة.",
      "tournament.openMatch": "فتح الملخص",
      "tournament.badgeHighlight": "ملخص فيديو",
      "tournament.bannerLink": "شاهد أرشيف كأس العالم — 104 مباراة",
      "tournament.featuredTitle": "أحدث مباراة يتوفر لها ملخص",
      "home.recentTweetsTitle": "الأكثر تداولاً على X",
      "home.recentTweetsLede": "أبرز المقاطع وردود الفعل المتداولة حول مباريات اليوم.",
      "home.recentTweetsMore": "عرض المزيد",
      "home.highlightBannersTitle": "أحدث الملخصات",
      "home.highlightBannersLede": "ملخصات المباريات الأخيرة وأبرز اللقطات بعد صافرة النهاية.",
      "home.highlightBannersAll": "كل المباريات →",
      "home.highlightBannerCta": "شاهد الملخص",
      "coverage.live": "تحديثات مباشرة",
      "coverage.lineups": "التشكيلة",
      "coverage.stats": "الإحصائيات",
      "status.upcoming": "لم تبدأ",
      "status.ended": "انتهت",
      "card.watch": "مشاهدة",
      "card.watchCommentary": "شاهد التغطية",
      "card.watchNow": "شاهد الآن",
      "card.summary": "ملخص المباراة",
      "card.highlightsTitle": "الأهداف وأبرز اللقطات",
      "card.memes": "ردود الفعل على X",
      "card.noHighlightVideo": "لم يتوفر فيديو ملخص لهذه المباراة بعد.",
      "matches.none": "لا توجد مباريات ضمن هذا التصنيف حالياً.",
      "search.title": "ابحث عن مباراة",
      "search.lede": "ابحث باسم الفريق أو البطولة أو المعلّق للوصول إلى المباراة بسرعة.",
      "search.placeholder": "فريق، بطولة أو معلّق…",
      "search.prompt": "ابدأ بكتابة اسم الفريق أو البطولة.",
      "search.none": "لم نجد نتائج مطابقة لـ «{q}».",
      "search.metaTitle": "البحث عن المباريات | كورة زيرو",
      "search.metaDesc": "ابحث عن مباريات الدوري الإنجليزي والدوري الإسباني ودوري أبطال أوروبا حسب الفريق أو البطولة أو المعلّق.",
      "live.empty": "لا توجد مباراة مباشرة الآن — راجع جدول مباريات اليوم أدناه.",
      "live.recentEnded": "انتهت قبل قليل · التغطية متاحة",
      "updated.prefix": "المصدر:",
      "updated.lastUpdate": "آخر تحديث",
      "updated.auto": "تحديث تلقائي",
      "updated.demo": "تعذّر تحميل الجدول المباشر؛ تُعرض بيانات احتياطية.",
      "watch.cleanView": "مشاهدة بواجهة نظيفة",
      "watch.reload": "إعادة تحميل البث",
      "watch.planWaiting": "جارٍ تجهيز البث",
      "watch.planWaitingHint": "سيظهر المشغّل تلقائياً فور تحديد مصدر صالح لهذه المباراة.",
      "watch.disclaimerTitle": "ملاحظة حول البث",
      "watch.disclaimer": "تُعرض المباراة من المصدر المتاح لها مباشرة. قد تأتي بعض المصادر من جهات خارجية، وتبقى حقوق النقل لأصحابها وفق القواعد المعمول بها في بلدك.",
      "watch.sourcesToggle": "القنوات ومصادر البث",
      "watch.servers": "مصادر البث",
      "watch.moreServers": "مصادر إضافية",
      "watch.altStreams": "مصادر بديلة",
      "watch.altStreamsNote": "يتم تحميل المشغّل الذي تختاره فقط، لتقليل التعارض واستهلاك الموارد.",
      "watch.altKooraLiveBanner": "Koora City متاح الآن — افتح هذا المشغّل",
      "watch.altKooraWorkingTag": "متاح الآن",
      "watch.streamHeal": "جارٍ استعادة الاتصال بالبث…",
      "watch.manualMirrorsTitle": "مصادر يدوية",
      "watch.manualMirrorsNote": "اختر مصدراً لتشغيله. لن ينتقل الموقع بين هذه المصادر تلقائياً.",
      "watch.manualMirrorsPick": "اختر مصدراً من الأعلى للتشغيل",
      "watch.manualMirrorFailed": "تعذّر تشغيل هذا المصدر — جرّب مصدراً آخر",
      "watch.optBridge": "اتصال وسيط (تجريبي)",
      "watch.optBridgeHint": "اتصال مباشر عبر خادم وسيط، من دون مشغّل مضمّن",
      "watch.endedCommentary": "انتهت · شاهد التغطية",
      "watch.ready": "جاهز للمشاهدة",
      "watch.noMatches": "لا توجد مباريات متاحة الآن",
      "srv.checking": "جارٍ فحص مصادر البث…",
      "srv.okPrefix": "المصادر المتاحة:",
      "srv.okSuffix": "— المصدر المميّز بالأخضر جاهز للمشاهدة",
      "srv.muteSuffix": "منها بدون صوت",
      "srv.down": "تعذّر تأكيد مصدر يعمل حالياً — يمكنك تجربة المصادر يدوياً.",
      "srv.working": "متاح",
      "srv.noAudio": "بدون صوت",
      "srv.hasAudio": "الصوت متاح",
      "srv.unreachable": "هذا المصدر غير متاح حالياً",
      "srv.checkingOne": "جارٍ فحص المصدر…"
    },
    en: {
      "nav.home": "Home",
      "nav.matches": "Today's matches",
      "nav.saved": "Saved",
      "nav.faq": "Quick info",
      "nav.live": "Live",
      "nav.tournament": "Highlights archive",
      "notice.seasonKicker": "Season update",
      "notice.seasonTitle": "Getting the new season ready",
      "notice.seasonBody": "We're preparing the new season's stream sources and improving playback reliability. Available matches will appear automatically as soon as they're ready.",
      "archive.kicker": "2026 archive",
      "archive.title": "World Cup 2026 — all 104 matches",
      "archive.lede": "Results, goals and available highlights from every match, kept together in one archive.",
      "archive.cta": "Explore the World Cup archive",
      "bookmark.save": "Add to favorites",
      "bookmark.aria": "Add KoraZero to favorites",
      "tv.eyebrow": "Big screen · No app required",
      "tv.title": "KoraZero on your TV",
      "tv.lede": "TV mode gives you a larger, clearer interface built for viewing from across the room, with full remote navigation and no app to install.",
      "tv.feat1title": "Designed for the big screen",
      "tv.feat1desc": "Text and controls scale up automatically so match information stays easy to read from a distance.",
      "tv.feat2title": "Full remote navigation",
      "tv.feat2desc": "Use the arrow keys to move between matches and players, then press OK to select.",
      "tv.feat3title": "Works in smart-TV browsers",
      "tv.feat3desc": "Compatible with Samsung, LG, Fire TV and Apple TV browsers, with a manual toggle available at any time.",
      "tv.feat4title": "The same match experience",
      "tv.feat4desc": "The same quality, channel, commentator and available stream source, presented in a big-screen layout.",
      "tv.statusOff": "TV mode is off on this device",
      "tv.statusOn": "TV mode is on — use your remote arrows to navigate",
      "tv.remoteHint": "Arrows to navigate · OK to select",
      "tv.stepsTitle": "Start watching on TV in 3 steps",
      "tv.step1": "Open korazero.com in your smart-TV browser, or send the link from your phone.",
      "tv.step2": "Turn on TV mode at the top of the page. You can also add <code>?tv=1</code> to the URL to enable it automatically.",
      "tv.step3": "Choose a match and press OK on your remote to open it.",
      "hero.quickSettings": "Viewing settings",
      "hero.tvHintPrefix": "On a big screen?",
      "hero.tvHintLink": "Turn on TV mode",
      "wc.archiveBadge": "104 matches · complete archive",
      "hero.noAds": "Clean interface, no intrusive ads",
      "seo.title": "Today's Football Matches, Live Scores & Streams | KoraZero",
      "seo.description": "Follow today's football on KoraZero with live streams when available, fixtures, live scores, lineups, statistics, channels and commentators for the Premier League, La Liga and Champions League.",
      "seo.ogTitle": "Today's Football Matches, Live Scores & Streams | KoraZero",
      "seo.ogDescription": "Today's football in one place: available live streams, live scores, fixtures, lineups, stats, channels and commentators.",
      "seo.twitterDescription": "Today's football on KoraZero — fixtures, live scores, match coverage and available streams.",
      "seo.keywords": "today's football matches, live football, live scores, football fixtures, football streams, Premier League, La Liga, Champions League, Arabic commentary, KoraZero",
      "seo.slogan": "Today's football and live match coverage in one place",
      "seo.keywordsAria": "KoraZero features",
      "seo.kw1": "Today's matches",
      "seo.kw2": "Live streams",
      "seo.kw3": "Live scores",
      "seo.kw4": "Lineups & stats",
      "seo.kw5": "Channels & commentators",
      "seo.kw6": "Riyadh & ET times",
      "hero.title": "Today's football live — <span>fixtures, scores and streams in one place</span>",
      "hero.lede": "Follow today's football from one place: fixtures, live scores, lineups, statistics, channels and commentators, with access to the available stream for each match. Focused coverage of the Premier League, La Liga and Champions League, with kick-off times in Riyadh and US Eastern Time.",
      "hero.usp1": "No intrusive ads",
      "hero.usp2": "Live score updates",
      "hero.usp3": "Lineups & statistics",
      "hero.usp4": "Available source selected automatically",
      "hero.ctaLive": "Watch available stream",
      "hero.seasonTitle": "The full match picture",
      "hero.seasonLede": "Official lineups appear before kick-off. During the match, the score, clock, scorers and statistics update automatically.",
      "hero.ctaArchive": "World Cup 2026 archive",
      "hero.ctaArchiveSub": "104 matches · goals & highlights · Arabic commentary",
      "hero.ctaMatches": "View today's matches",
      "season.liveCoverage": "Live coverage · 2026/27 season",
      "season.title": "Europe's biggest matches, live",
      "season.lede": "Fixtures, scores, lineups, goals and statistics update throughout the match.",
      "season.openSchedule": "View today's matches",
      "season.worldCupArchive": "World Cup 2026 archive · 104 matches",
      "stage.title": "European nights, live",
      "stage.lede": "Premier League · La Liga · Champions League — fixtures, scores, lineups and statistics updated live.",
      "stage.railTitle": "Top European competitions",
      "matches.title": "Today's matches",
      "matches.lede": "Choose a competition and follow today's matches and what's coming next. Scores and match status update automatically.",
      "faq.title": "Quick information",
      "faq.q1": "What do I get on a match page?",
      "faq.a1": "Kick-off time, live score, lineups, statistics and goals, plus the channel, commentator and a watch link when a stream is available.",
      "faq.q2": "Which competitions does KoraZero cover?",
      "faq.a2": "KoraZero focuses on the Premier League, La Liga and UEFA Champions League, with schedules, scores and live match details when available.",
      "faq.q3": "Which time zones are match times shown in?",
      "faq.a3": "Kick-off times are shown in Riyadh and US Eastern Time (ET), making the start time clear for viewers in the Middle East and the United States.",
      "footer.about": "KoraZero brings together today's fixtures, live scores, lineups, statistics, channels and commentators, with access to the available stream for each match from one interface.",
      "footer.disclaimer": "Some viewing sources may be provided by third parties. Broadcast and trademark rights remain with their respective owners and local rules apply.",
      "footer.bottom": "© 2026 KoraZero · Today's football, simplified.",
      "footer.bottomShort": "© 2026 KoraZero",
      "tournament.title": "World Cup 2026 Archive",
      "tournament.lede": "Every match in one archive: results, goals, key moments and available highlights.",
      "tournament.highlightTitle": "Match highlights",
      "tournament.goalsTitle": "Goals",
      "tournament.goalsHint": "Goals only · about 3–4 min",
      "tournament.fullHint": "Key match moments · about 10 min",
      "tournament.notableClipsTitle": "Key moments",
      "tournament.memesTitle": "Trending on X",
      "tournament.noHighlight": "A highlight video isn't available for this match yet.",
      "tournament.noMemes": "There are no notable posts linked to this match right now.",
      "tournament.empty": "No matches are available in this stage yet.",
      "tournament.loadError": "The tournament archive couldn't be loaded.",
      "tournament.openMatch": "Open highlights",
      "tournament.badgeHighlight": "Video highlights",
      "tournament.bannerLink": "Explore the World Cup archive — 104 matches",
      "tournament.featuredTitle": "Latest match with highlights",
      "home.recentTweetsTitle": "Trending on X",
      "home.recentTweetsLede": "The clips and reactions getting the most attention around today's matches.",
      "home.recentTweetsMore": "View more",
      "home.highlightBannersTitle": "Latest highlights",
      "home.highlightBannersLede": "Recent match highlights and key moments after the final whistle.",
      "home.highlightBannersAll": "All matches →",
      "home.highlightBannerCta": "Watch highlights",
      "coverage.live": "Live updates",
      "coverage.lineups": "Lineups",
      "coverage.stats": "Statistics",
      "status.upcoming": "Not started",
      "status.ended": "Full time",
      "card.watch": "Watch",
      "card.watchCommentary": "View coverage",
      "card.watchNow": "Watch now",
      "card.summary": "Arabic match recap",
      "card.highlightsTitle": "Goals & highlights",
      "card.memes": "Reactions on X",
      "card.noHighlightVideo": "A highlight video isn't available for this match yet.",
      "matches.none": "There are no matches in this category right now.",
      "search.title": "Find a match",
      "search.lede": "Search by team, competition or commentator to get to the right match quickly.",
      "search.placeholder": "Team, competition or commentator…",
      "search.prompt": "Start typing a team or competition.",
      "search.none": "No matches found for “{q}”.",
      "search.metaTitle": "Find football matches | KoraZero",
      "search.metaDesc": "Search Premier League, La Liga and Champions League matches by team, competition or commentator.",
      "live.empty": "No match is live right now — check today's schedule below.",
      "live.recentEnded": "Just finished · coverage available",
      "updated.prefix": "Source:",
      "updated.lastUpdate": "Last updated",
      "updated.auto": "Auto-updating",
      "updated.demo": "The live schedule couldn't be loaded; fallback data is shown.",
      "watch.cleanView": "Clean viewing interface",
      "watch.reload": "Reload stream",
      "watch.planWaiting": "Preparing the stream",
      "watch.planWaitingHint": "The player will appear automatically as soon as a valid source is assigned to this match.",
      "watch.disclaimerTitle": "Broadcast note",
      "watch.disclaimer": "The match is shown from the source currently available for it. Some sources may be provided by third parties; broadcast rights remain with their owners and local rules apply.",
      "watch.sourcesToggle": "Channels & stream sources",
      "watch.servers": "Stream sources",
      "watch.moreServers": "More sources",
      "watch.altStreams": "Alternative sources",
      "watch.altStreamsNote": "Only the player you select is loaded, reducing conflicts and unnecessary resource use.",
      "watch.altKooraLiveBanner": "Koora City is available now — open this player",
      "watch.altKooraWorkingTag": "Available now",
      "watch.streamHeal": "Reconnecting to the stream…",
      "watch.manualMirrorsTitle": "Manual sources",
      "watch.manualMirrorsNote": "Choose a source to load it. KoraZero won't switch between these sources automatically.",
      "watch.manualMirrorsPick": "Choose a source above to play",
      "watch.manualMirrorFailed": "This source couldn't be played — try another one",
      "watch.optBridge": "Proxy connection (experimental)",
      "watch.optBridgeHint": "Direct connection through a proxy server, without an embedded player",
      "watch.endedCommentary": "Full time · view coverage",
      "watch.ready": "Ready to watch",
      "watch.noMatches": "No matches are available right now",
      "srv.checking": "Checking stream sources…",
      "srv.okPrefix": "Available sources:",
      "srv.okSuffix": "— green indicates a source ready to play",
      "srv.muteSuffix": "have no audio",
      "srv.down": "No working source could be confirmed right now — you can still try the sources manually.",
      "srv.working": "Available",
      "srv.noAudio": "No audio",
      "srv.hasAudio": "Audio available",
      "srv.unreachable": "This source is unavailable right now",
      "srv.checkingOne": "Checking source…"
    }
  };

  const baseT = i18n.t.bind(i18n);
  function interpolate(value, vars) {
    let out = String(value);
    if (!vars) return out;
    Object.keys(vars).forEach((key) => {
      out = out.split(`{${key}}`).join(String(vars[key]));
    });
    return out;
  }
  i18n.t = function refreshedTranslation(key, vars) {
    const value = COPY[i18n.lang] && COPY[i18n.lang][key];
    return value == null ? baseT(key, vars) : interpolate(value, vars);
  };

  function setMeta(selector, value) {
    const el = document.querySelector(selector);
    if (el && value) el.setAttribute("content", value);
  }

  function applyMeta() {
    document.title = i18n.t("seo.title");
    setMeta('meta[name="description"]', i18n.t("seo.description"));
    setMeta('meta[name="keywords"]', i18n.t("seo.keywords"));
    setMeta('meta[property="og:title"]', i18n.t("seo.ogTitle"));
    setMeta('meta[property="og:description"]', i18n.t("seo.ogDescription"));
    setMeta('meta[property="og:locale"]', i18n.lang === "ar" ? "ar_AR" : "en_US");
    setMeta('meta[name="twitter:title"]', i18n.t("seo.ogTitle"));
    setMeta('meta[name="twitter:description"]', i18n.t("seo.twitterDescription"));
  }

  function applyStaticCopy() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = i18n.t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = i18n.t(el.getAttribute("data-i18n-html"));
    });
    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.getAttribute("data-i18n-attr").split(",").forEach((pair) => {
        const [attr, key] = pair.split(":").map((part) => part.trim());
        if (attr && key) el.setAttribute(attr, i18n.t(key));
      });
    });
  }

  function trimFaq() {
    ["faq.q4", "faq.q5", "faq.q6"].forEach((key) => {
      const summary = document.querySelector(`[data-i18n="${key}"]`);
      const item = summary && summary.closest("details");
      if (item) item.remove();
    });
  }

  function refreshSchema() {
    const el = document.getElementById("seo-schema");
    if (!el) return;
    let schema;
    try {
      schema = JSON.parse(el.textContent || "{}");
    } catch {
      return;
    }
    const graph = Array.isArray(schema["@graph"]) ? schema["@graph"] : [];
    const org = graph.find((node) => node && node["@type"] === "Organization");
    if (org) org.slogan = i18n.t("seo.slogan");
    const site = graph.find((node) => node && node["@type"] === "WebSite");
    if (site) site.inLanguage = i18n.lang;
    const faq = graph.find((node) => node && node["@type"] === "FAQPage");
    if (faq) {
      faq.mainEntity = [1, 2, 3].map((n) => ({
        "@type": "Question",
        name: i18n.t(`faq.q${n}`),
        acceptedAnswer: { "@type": "Answer", text: i18n.t(`faq.a${n}`) }
      }));
    }
    el.textContent = JSON.stringify(schema);
  }

  const EN_HTML = [
    ["ضد نفسه", "Own goal"],
    ["هدف في مرماه", "Own goal"],
    ["ركلة جزاء", "Penalty"],
    ["الاستحواذ", "Possession"],
    ["تسديدات على المرمى", "Shots on target"],
    ["التسديدات", "Shots"],
    ["الركلات الركنية", "Corners"],
    ["البطاقات الصفراء", "Yellow cards"],
    ["البطاقات الحمراء", "Red cards"],
    ["دقة التمرير", "Pass accuracy"],
    ["التمريرات", "Passes"],
    ["التدخلات", "Tackles"],
    ["الاعتراضات", "Interceptions"],
    ["الإبعادات", "Clearances"],
    ["العرضيات", "Crosses"],
    ["التصديات", "Saves"],
    ["الأخطاء", "Fouls"],
    ["التسلل", "Offsides"],
    ["الهجوم", "Attack"],
    ["التمرير", "Passing"],
    ["الدفاع", "Defence"],
    ["الانضباط", "Discipline"],
    ["إنذار ثانٍ ← طرد", "Second yellow → red"],
    ["بطاقة حمراء", "Red card"],
    ["بطاقة صفراء", "Yellow card"],
    ["بديل عن", "On for"]
  ];

  function translateGeneratedHtml(html) {
    if (!html) return html;
    let out = String(html).split("ضد نفسه").join("هدف في مرماه");
    if (i18n.lang !== "en") return out;
    EN_HTML.forEach(([from, to]) => {
      out = out.split(from).join(to);
    });
    return out;
  }

  function patchGeneratedUi() {
    ["buildGoalsHtml", "buildStatsHtml", "buildLineupsHtml"].forEach((name) => {
      const fn = global[name];
      if (typeof fn !== "function" || fn.__kzEditorialPatched) return;
      const wrapped = function (...args) {
        return translateGeneratedHtml(fn.apply(this, args));
      };
      wrapped.__kzEditorialPatched = true;
      global[name] = wrapped;
    });
  }

  applyMeta();
  let attempts = 0;
  const dynamicTimer = setInterval(() => {
    patchGeneratedUi();
    attempts += 1;
    if (attempts > 300 || ["buildGoalsHtml", "buildStatsHtml", "buildLineupsHtml"].every((name) => global[name]?.__kzEditorialPatched)) {
      clearInterval(dynamicTimer);
    }
  }, 20);

  document.addEventListener("DOMContentLoaded", () => {
    applyStaticCopy();
    trimFaq();
    refreshSchema();
    patchGeneratedUi();
    document.documentElement.classList.add("kz-dark-refresh");
  });
})(window);
