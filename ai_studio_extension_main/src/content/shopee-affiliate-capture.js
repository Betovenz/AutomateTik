// Isolated-world bridge for the MAIN-world Shopee API hook. Captures are batched
// briefly to keep MV3 messaging light while still reaching AutoGT in real time.
(() => {
  if (window.__autogtShopeeAffiliateCaptureBridgeInstalled) return;
  window.__autogtShopeeAffiliateCaptureBridgeInstalled = true;

  const MESSAGE_SOURCE = "autogt-shopee-affiliate-api";
  const queue = [];
  let flushTimer = null;

  const flush = () => {
    flushTimer = null;
    if (!queue.length) return;
    const captures = queue.splice(0, 20);
    chrome.runtime.sendMessage({
      type: "autogt.shopee.affiliate.api",
      captures,
    }).catch(() => {});
    if (queue.length) flushTimer = setTimeout(flush, 250);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== MESSAGE_SOURCE || !event.data?.capture) return;
    queue.push(event.data.capture);
    if (queue.length >= 20) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 250);
  });
})();
