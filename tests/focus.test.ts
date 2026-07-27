import { afterEach, describe, expect, it } from "vitest";

import {
  blurActiveNonEditableElement,
  createPointerFocusGuard,
  shouldHandleSpaceAsPlayback,
} from "@/common/utils/focus";

afterEach(() => {
  document.body.replaceChildren();
});

describe("blurActiveNonEditableElement", () => {
  it("releases focus left on interactive controls before an app shortcut runs", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    expect(document.activeElement).toBe(button);
    blurActiveNonEditableElement();
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps text editing focus intact", () => {
    for (const element of [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
    ]) {
      document.body.replaceChildren(element);
      element.focus();

      blurActiveNonEditableElement();
      expect(document.activeElement).toBe(element);
    }

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const editableChild = document.createElement("span");
    editableChild.tabIndex = 0;
    editable.append(editableChild);
    document.body.replaceChildren(editable);
    editableChild.focus();

    blurActiveNonEditableElement();
    expect(document.activeElement).toBe(editableChild);
  });
});

describe("createPointerFocusGuard", () => {
  const focusFromPointer = (button: HTMLButtonElement, guard: ReturnType<typeof createPointerFocusGuard>) => {
    guard.handlePointerDown(new Event("pointerdown"));
    button.focus();
    const focusInEvent = new FocusEvent("focusin", { relatedTarget: document.body });
    Object.defineProperty(focusInEvent, "target", { value: button });
    guard.handleFocusIn(focusInEvent);
    guard.handlePointerEnd();
  };

  it("returns the released pointer focus for the first Space press", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const guard = createPointerFocusGuard();

    focusFromPointer(button, guard);

    const event = new KeyboardEvent("keydown", { key: " " });
    const released = guard.releaseForKeyDown(event, false);
    expect(released).toBe(button);
    expect(document.activeElement).toBe(document.body);
    expect(shouldHandleSpaceAsPlayback(event, released)).toBe(true);
    expect(shouldHandleSpaceAsPlayback(new KeyboardEvent("keydown", { key: " " }), null)).toBe(true);
  });

  it("leaves activation to the configured app shortcut after releasing pointer focus", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const guard = createPointerFocusGuard();
    focusFromPointer(button, guard);

    expect(guard.releaseForKeyDown(new KeyboardEvent("keydown", { key: "p" }), true)).toBe(button);
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps Tab-originated focus for accessible keyboard activation", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const guard = createPointerFocusGuard();

    button.focus();

    const event = new KeyboardEvent("keydown", { key: " " });
    const released = guard.releaseForKeyDown(event, false);
    expect(released).toBeNull();
    expect(shouldHandleSpaceAsPlayback(event, released)).toBe(false);
    expect(document.activeElement).toBe(button);
  });
});
