#!/usr/bin/env node
import { chromium, webkit } from "playwright";

const HOME = "https://korazero.com/";

async function verify(name, browserType, contextOptions = {}) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    const response = await page.goto(`${HOME}?iptv-stage-smoke=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    if (!response?.ok()) throw new Error(`homepage navigation HTTP ${response?.status()}`);

    await page.waitForFunction(() => Boolean(
      window.KZIptvLegacyToggleNormalizer
      && window.KZIptvWindow
      && window.KZIptvChannelResolver
    ));

    const homepageScripts = await page.evaluate(() =>
      [...document.scripts].map((script) => script.src).filter(Boolean)
    );
    if (homepageScripts.some((src) => src.includes("/assets/js/iptv-auto.js"))) {
      throw new Error("homepage loaded iptv-auto.js; retired gold/silver routing can resurface");
    }
    if (homepageScripts.some((src) => src.includes("/assets/js/iptv-premium-card-click.js"))) {
      throw new Error("homepage loaded retired iptv-premium-card-click.js");
    }

    // Defense-in-depth check: even if old markup is injected, the legacy
    // normalizer must collapse it back to the single normal watch link.
    await page.evaluate(() => {
      document.getElementById("pw-legacy-euro-card")?.remove();
      const card = document.createElement("article");
      card.id = "pw-legacy-euro-card";
      card.className = "match-card";
      card.innerHTML = `
        <div class="teams"><div class="team"><span class="tname">PW Euro Home</span></div></div>
        <div class="match-foot">
          <div class="watch-source-toggle" role="group">
            <div class="watch-source-toggle__track">
              <a class="watch-source-toggle__opt watch-source-toggle__opt--premium"
                 href="watch.html?ch=bein-sports-1&match=pw-legacy-euro&source=iptv-premium">
                <span>مشاهدة مميزة</span>
              </a>
              <a class="watch-source-toggle__opt watch-source-toggle__opt--original"
                 href="watch.html?ch=bein-sports-1&match=pw-legacy-euro">
                <span>البث الأصلي</span>
              </a>
            </div>
          </div>
        </div>`;
      (document.getElementById("matches-grid") || document.body).appendChild(card);
    });

    await page.waitForFunction(() => {
      const card = document.getElementById("pw-legacy-euro-card");
      return card
        && !card.querySelector('.watch-source-toggle__opt--premium[href*="source=iptv-premium"]')
        && Boolean(card.querySelector('a.watch-link[href*="match=pw-legacy-euro"]'));
    });

    const synthetic = await page.locator("#pw-legacy-euro-card").evaluate((card) => {
      const link = card.querySelector("a.watch-link");
      return {
        text: link?.textContent?.trim() || "",
        href: link?.getAttribute("href") || "",
        legacyPremiumCount: card.querySelectorAll('a[href*="source=iptv-premium"]').length,
        xtreamCount: card.querySelectorAll('a[href*="source=xtream"]').length,
        toggleCount: card.querySelectorAll(".watch-source-toggle, .iptv-auto-toggle").length,
      };
    });
    if (synthetic.legacyPremiumCount !== 0 || synthetic.xtreamCount !== 0 || synthetic.toggleCount !== 0) {
      throw new Error(`legacy Euro toggle was not collapsed: ${JSON.stringify(synthetic)}`);
    }

    await page.waitForTimeout(1500);
    const realBadRoutes = await page.locator(
      '#matches-grid a[href*="source=iptv-premium"], #matches-grid a[href*="source=xtream"], #matches-grid .iptv-auto-toggle'
    ).count();
    if (realBadRoutes !== 0) {
      throw new Error(`production homepage still exposes retired source routing (${realBadRoutes} nodes)`);
    }

    console.log(JSON.stringify({
      browser: name,
      homepageRoutingContract: "pass",
      syntheticLegacyEuro: synthetic,
      productionRetiredRoutes: realBadRoutes,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

await verify("chromium", chromium, { viewport: { width: 390, height: 844 } });
await verify("webkit", webkit, { viewport: { width: 390, height: 844 } });
console.log("✓ homepage routing contract passes in deployed Chromium + WebKit");
