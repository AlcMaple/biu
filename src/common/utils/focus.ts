const EDITABLE_SELECTOR = "input, textarea, select";
const CONTROL_ACTIVATION_KEYS = new Set([" ", "Enter"]);

/** 是否正在文本 / 表单编辑上下文中；快捷键监听与焦点释放共用，避免两套例外名单漂移。 */
export function isEditableElement(element: EventTarget | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const contentEditableHost = element.closest<HTMLElement>('[contenteditable]:not([contenteditable="false"])');
  return element.matches(EDITABLE_SELECTOR) || element.isContentEditable || Boolean(contentEditableHost);
}

/**
 * 应用快捷键执行前释放鼠标点击遗留的控件焦点，避免按键把该控件切成 focus-visible 状态。
 * 输入控件和可编辑区域不处理，防止快捷键监听破坏正在进行的输入。
 */
export function blurActiveNonEditableElement(doc: Document = document): void {
  const active = doc.activeElement;
  if (!(active instanceof HTMLElement) || active === doc.body) return;
  if (isEditableElement(active)) return;
  active.blur();
}

/**
 * 区分鼠标遗留焦点和真正的键盘导航焦点。
 *
 * 鼠标点击按钮后，浏览器仍会让按钮成为 activeElement；随后按空格 / 回车时，
 * React Aria 会把它切换成 focus-visible。只有这类鼠标来源的焦点可以在按键前释放，
 * Tab 导航得到的焦点必须保留，才能继续显示正常的键盘焦点反馈。
 */
export function createPointerFocusGuard(doc: Document = document) {
  let isPointerDown = false;
  let pointerFocusedElement: HTMLElement | null = null;

  const handlePointerDown = (event: Event) => {
    isPointerDown = true;

    const active = doc.activeElement;
    if (
      active instanceof HTMLElement &&
      event.target instanceof Node &&
      (event.target === active || active.contains(event.target))
    ) {
      pointerFocusedElement = active;
    }
  };

  const handleFocusIn = (event: FocusEvent) => {
    pointerFocusedElement =
      isPointerDown && event.target instanceof HTMLElement && !isEditableElement(event.target) ? event.target : null;
  };

  const handlePointerEnd = () => {
    isPointerDown = false;
  };

  const releaseForKeyDown = (event: KeyboardEvent, isAppShortcut: boolean): HTMLElement | null => {
    if (!isAppShortcut && !CONTROL_ACTIVATION_KEYS.has(event.key)) return null;

    const active = doc.activeElement;
    if (!(active instanceof HTMLElement) || active !== pointerFocusedElement || isEditableElement(active)) return null;

    active.blur();
    pointerFocusedElement = null;
    return active;
  };

  return {
    handlePointerDown,
    handleFocusIn,
    handlePointerEnd,
    releaseForKeyDown,
  };
}

/**
 * 空格在页面背景或鼠标遗留焦点上是播放器级播放 / 暂停键；Tab 聚焦控件时仍交给该控件原生处理。
 * activeElement 回到 body 后仍返回 true，因此连续按空格可以持续切换播放状态。
 */
export function shouldHandleSpaceAsPlayback(
  event: KeyboardEvent,
  releasedPointerFocus: HTMLElement | null,
  doc: Document = document,
): boolean {
  return event.key === " " && (Boolean(releasedPointerFocus) || doc.activeElement === doc.body);
}
