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
      && window.__KZ_MATCH_CARD_CLICK_BUILD === "20260904cardclick4"
    ));

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
        toggleCount: card.querySelectorAll(".watch-source-toggle").length,
      };
    });
    if (synthetic.legacyPremiumCount !== 0 || synthetic.toggleCount !== 0) {
      throw new Error(`legacy Euro toggle was not collapsed: ${JSON.stringify(synthetic)}`);
    }
    if (!synthetic.text.includes("تفاصيل") && !/details/i.test(synthetic.text)) {
      throw new Error(`legacy Euro card did not normalize to match details: ${JSON.stringify(synthetic)}`);
    }

    await page.waitForTimeout(1500);
    const realLegacyCount = await page.locator('#matches-grid a[href*="source=iptv-premium"]').count();
    if (realLegacyCount !== 0) {
      const hrefs = await page.locator('#matches-grid a[href*="source=iptv-premium"]').evaluateAll((nodes) =>
        nodes.slice(0, 5).map((node) => node.getAttribute("href"))
      );
      throw new Error(`production still exposes retired premium card routes: ${JSON.stringify(hrefs)}`);
    }

    console.log(JSON.stringify({
      browser: name,
      unifiedStageContract: "pass",
      syntheticLegacyEuro: synthetic,
      productionLegacyPremiumRoutes: realLegacyCount,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

await verify("chromium", chromium, { viewport: { width: 390, height: 844 } });
await verify("webkit", webkit, { viewport: { width: 390, height: 844 } });
console.log("✓ unified IPTV card-stage contract passes in deployed Chromium + WebKit");
