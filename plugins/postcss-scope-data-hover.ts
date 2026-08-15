const HOVER_EFFECTS_GATE = ':where(:root[data-hover-effects="enabled"])';
const HOVER_EFFECTS_ATTRIBUTE = "data-hover-effects";

type PostCssRule = {
  selector?: string;
};

const getAttributeEnd = (selector: string, start: number) => {
  let quote: '"' | "'" | undefined;

  for (let index = start + 1; index < selector.length; index += 1) {
    const character = selector[index];

    if (character === "\\") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "]") return index;
  }

  return -1;
};

const getDataHoverAttributeName = (attribute: string) => {
  const match = /^\s*(data-hover(?:-[\w-]+)?)(?=\s*(?:[~|^$*]?=|$))/i.exec(attribute);
  if (!match) return undefined;

  const attributeName = match[1].toLowerCase();
  return attributeName === HOVER_EFFECTS_ATTRIBUTE ? undefined : attributeName;
};

export const containsDataHoverAttribute = (selector: string) => {
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];

    if (character === "\\") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "/" && selector[index + 1] === "*") {
      const commentEnd = selector.indexOf("*/", index + 2);
      if (commentEnd === -1) return false;
      index = commentEnd + 1;
      continue;
    }
    if (character !== "[") continue;

    const attributeEnd = getAttributeEnd(selector, index);
    if (attributeEnd === -1) return false;
    if (getDataHoverAttributeName(selector.slice(index + 1, attributeEnd))) return true;
    index = attributeEnd;
  }

  return false;
};

const splitSelectorList = (selectorList: string) => {
  const selectors: string[] = [];
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let quote: '"' | "'" | undefined;
  let selectorStart = 0;

  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];

    if (character === "\\") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "/" && selectorList[index + 1] === "*") {
      const commentEnd = selectorList.indexOf("*/", index + 2);
      if (commentEnd === -1) break;
      index = commentEnd + 1;
      continue;
    }
    if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === "(") parenthesisDepth += 1;
    else if (character === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    else if (character === "," && bracketDepth === 0 && parenthesisDepth === 0) {
      selectors.push(selectorList.slice(selectorStart, index));
      selectorStart = index + 1;
    }
  }

  selectors.push(selectorList.slice(selectorStart));
  return selectors;
};

const hasHoverEffectsGate = (selector: string) => selector.includes(`[${HOVER_EFFECTS_ATTRIBUTE}="enabled"]`);

export const scopeDataHoverSelectorList = (selectorList: string) =>
  splitSelectorList(selectorList)
    .map(selector => {
      if (!containsDataHoverAttribute(selector) || hasHoverEffectsGate(selector)) return selector;

      const leadingWhitespace = /^\s*/.exec(selector)?.[0] ?? "";
      return `${leadingWhitespace}${HOVER_EFFECTS_GATE} ${selector.slice(leadingWhitespace.length)}`;
    })
    .join(",");

const postcssScopeDataHover = {
  postcssPlugin: "postcss-scope-data-hover",
  Rule(rule: PostCssRule) {
    if (rule.selector) rule.selector = scopeDataHoverSelectorList(rule.selector);
  },
};

export default postcssScopeDataHover;
