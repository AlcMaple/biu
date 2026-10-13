const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);
const TAP_SLOP = 10;
const KEYBOARD_SETTLE_MS = 600;
const KEYBOARD_MARGIN = 12;

type TextEntry = HTMLInputElement | HTMLTextAreaElement;

const isIos = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isTextEntry = (el: unknown): el is TextEntry => {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
};

const resolveTapTarget = (target: EventTarget | null): TextEntry | null => {
  if (!(target instanceof Element)) return null;
  const direct = target.closest("input, textarea");
  if (isTextEntry(direct)) return direct;
  const label = target.closest("label");
  return isTextEntry(label?.control) ? label.control : null;
};

const isScrollable = (el: HTMLElement) => {
  const { overflowY } = getComputedStyle(el);
  return /(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > el.clientHeight;
};

const findScrollParent = (el: HTMLElement) => {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (isScrollable(node)) return node;
  }
  return null;
};

// iOS 聚焦输入框时会滚动根文档，fixed 的弹窗 / 底栏随之偏移且收起键盘后不回位，
// 所以只在输入框真的被键盘遮住时，才滚它所在的滚动容器（没有才滚根文档）。
const revealIfCovered = () => {
  const el = document.activeElement;
  const viewport = window.visualViewport;
  if (!viewport || !(el instanceof HTMLElement) || !isTextEntry(el)) return;

  const rect = el.getBoundingClientRect();
  const visibleBottom = viewport.offsetTop + viewport.height - KEYBOARD_MARGIN;
  const overflow = rect.bottom - visibleBottom;
  if (overflow <= 0) return;

  const scroller = findScrollParent(el);
  if (scroller) scroller.scrollTop += overflow;
  else window.scrollBy(0, overflow);
};

export function installIosKeyboardFocus() {
  if (typeof window === "undefined" || !isIos()) return;

  const nativeFocus = HTMLElement.prototype.focus;
  let allowFocus = false;

  // 代码触发的聚焦（autoFocus / .focus()）紧跟用户点击时 iOS 会弹键盘并滚动页面，文本输入框只认真实点击
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (isTextEntry(this) && !allowFocus) return;
    nativeFocus.call(this, { ...options, preventScroll: true });
  };

  const focusWithoutScroll = (el: TextEntry) => {
    const previous = el.style.transform;
    el.style.transform = "translateY(-10000px)";
    allowFocus = true;
    try {
      el.focus();
    } finally {
      allowFocus = false;
    }
    requestAnimationFrame(() => {
      el.style.transform = previous;
    });
  };

  let start: { x: number; y: number } | null = null;

  document.addEventListener(
    "touchstart",
    event => {
      const touch = event.touches[0];
      start = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    "touchend",
    event => {
      const origin = start;
      start = null;
      const touch = event.changedTouches[0];
      if (!origin || !touch) return;
      if (Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > TAP_SLOP) return;

      const input = resolveTapTarget(event.target);
      if (!input || input.disabled || input.readOnly) return;
      // 键盘已弹出时交还系统，才能点击移动光标
      if (document.activeElement === input) return;

      event.preventDefault();
      focusWithoutScroll(input);
    },
    { passive: false, capture: true },
  );

  let settleTimer: number | undefined;
  document.addEventListener("focusin", event => {
    if (!isTextEntry(event.target)) return;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(revealIfCovered, KEYBOARD_SETTLE_MS);
  });
  window.visualViewport?.addEventListener("resize", revealIfCovered);
}
