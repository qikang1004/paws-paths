/** 去掉 CSS 注释，避免注释里的示例值触发误报。 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 十六进制色值一律视为违规：色值只能来自 tokens.wxss。 */
export function findHexLiterals(css: string): string[] {
  return stripComments(css).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
}

/** 裸 px 一律视为违规：长度只能用 rpx 或 var()。 */
export function findBarePx(css: string): string[] {
  return stripComments(css).match(/(?<![\w-])-?[\d.]+px\b/g) ?? [];
}

/** 引用了 tokens.wxss 未定义的变量，说明 token 名漂移了。 */
export function findUndefinedVars(consumerCss: string, tokensCss: string): string[] {
  const defined = new Set(
    Array.from(stripComments(tokensCss).matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]),
  );
  const used = Array.from(
    stripComments(consumerCss).matchAll(/var\(\s*(--[\w-]+)/g),
    (m) => m[1],
  );
  return [...new Set(used.filter((name) => !defined.has(name)))];
}
