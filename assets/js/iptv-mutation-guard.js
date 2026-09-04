/* Narrow MutationObserver guard for the unified IPTV card router.
 *
 * iptv-auto rewrites the contents of .watch-source-toggle. Its document-wide
 * observer must not treat those self-generated child mutations as fresh card
 * renders, otherwise it can continuously rewrite the same toggle and starve
 * the browser main thread. All mutations outside watch-source-toggle continue
 * through unchanged.
 */
(function () {
  "use strict";

  const NativeMutationObserver = window.MutationObserver;
  if (typeof NativeMutationObserver !== "function" || window.__KZ_IPTV_MUTATION_GUARD) return;

  const GuardedMutationObserver = function (callback) {
    const source = (() => {
      try { return Function.prototype.toString.call(callback); } catch { return ""; }
    })();
    const isIptvRewriteObserver = source.includes("queueRewrite");

    const nativeObserver = new NativeMutationObserver((mutations) => {
      if (!isIptvRewriteObserver) {
        callback(mutations, wrapper);
        return;
      }

      const relevant = mutations.filter((mutation) => {
        if (mutation.type !== "childList") return true;
        const target = mutation.target;
        if (!(target instanceof Element)) return true;
        return !target.closest(".watch-source-toggle");
      });
      if (relevant.length) callback(relevant, wrapper);
    });

    const wrapper = {
      observe: (...args) => nativeObserver.observe(...args),
      disconnect: () => nativeObserver.disconnect(),
      takeRecords: () => nativeObserver.takeRecords(),
    };
    return wrapper;
  };

  GuardedMutationObserver.prototype = NativeMutationObserver.prototype;
  window.MutationObserver = GuardedMutationObserver;
  window.__KZ_IPTV_MUTATION_GUARD = true;

  let released = false;
  function restoreNative() {
    if (released) return;
    released = true;
    window.MutationObserver = NativeMutationObserver;
  }

  window.__KZ_RELEASE_IPTV_MUTATION_GUARD = function () {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(restoreNative, 0), { once: true });
    } else {
      setTimeout(restoreNative, 0);
    }
  };
})();
