(function () {
  var TIMEOUT_MS = 4000;
  var fired = false;

  function looksBlank(element) {
    if (!element) return true;
    var html = element.innerHTML.trim();
    if (html === "") return true;
    return /加载中|loading\.\.\./i.test(html) && element.childElementCount <= 1;
  }

  function check() {
    if (fired) return;
    fired = true;
    if (document.visibilityState === "hidden") return;
    if (!looksBlank(document.getElementById("root"))) return;

    var detail = "path=" + location.pathname + " ua=" + navigator.userAgent.slice(0, 120);

    console.error("[white-screen-probe] #root 在 " + TIMEOUT_MS + "ms 后仍为空", detail);

    var monitoring = window.__biuMonitoring;
    if (monitoring && typeof monitoring.captureMessage === "function") {
      monitoring.captureMessage("应用白屏：#root 未渲染 (" + detail + ")", "fatal");
    }
  }

  window.addEventListener("load", function () {
    setTimeout(check, TIMEOUT_MS);
  });
})();
