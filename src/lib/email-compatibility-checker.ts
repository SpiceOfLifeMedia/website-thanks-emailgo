export type EmailCompatibilitySeverity = 'error' | 'warning';

export type EmailCompatibilityIssue = {
  code: string;
  severity: EmailCompatibilitySeverity;
  line: number;
  index: number;
  message: string;
};

type CompatibilityRule = {
  code: string;
  severity: EmailCompatibilitySeverity;
  pattern: RegExp;
  message: string;
};

const rules: CompatibilityRule[] = [
  { code: 'script_element', severity: 'error', pattern: /<\s*script\b[^>]*>/gi, message: 'Script elements are removed by many email clients.' },
  { code: 'event_handler', severity: 'error', pattern: /\bon[a-z]{3,30}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, message: 'Event handlers are removed by many email clients.' },
  { code: 'unsupported_element', severity: 'warning', pattern: /<\s*(?:iframe|svg|form)\b[^>]*>/gi, message: 'This element may be removed or rendered inconsistently.' },
  { code: 'external_stylesheet', severity: 'warning', pattern: /<\s*link\b[^>]*\brel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet\b)[^>]*>|@import\s+(?:url\()?\s*["']?[^;\s)]+/gi, message: 'Linked stylesheets are often blocked; inline the email styles.' },
  { code: 'flex_or_grid', severity: 'warning', pattern: /\bdisplay\s*:\s*(?:inline-)?(?:flex|grid)\b/gi, message: 'Flexbox and grid have uneven support in desktop mail clients.' },
  { code: 'fixed_position', severity: 'warning', pattern: /\bposition\s*:\s*fixed\b/gi, message: 'Fixed positioning is not supported consistently in email clients.' },
  { code: 'viewport_units', severity: 'warning', pattern: /(?:\d+(?:\.\d+)?|\.\d+)(?:vw|vh|svw|svh|lvw|lvh|dvw|dvh)\b/gi, message: 'Viewport units are not supported consistently in email clients.' },
  { code: 'css_math', severity: 'warning', pattern: /\b(?:clamp|min|max)\s*\(/gi, message: 'This CSS math function is not supported consistently in email clients.' },
  { code: 'css_variable_without_fallback', severity: 'warning', pattern: /var\(\s*--[\w-]+\s*\)/gi, message: 'Add a fallback color or value when using a CSS variable.' },
  { code: 'modern_color', severity: 'warning', pattern: /\b(?:oklch|color-mix)\s*\(/gi, message: 'This modern color function may be dropped; provide a compatible fallback.' },
  { code: 'framework_markup', severity: 'warning', pattern: /\bdata-reactroot\b|\bdata-nextjs(?:-portal)?\b|\bid\s*=\s*["'](?:__next|__nuxt)["']/gi, message: 'Framework markup is usually not needed in an email document.' },
];

function lineForOffset(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

export function checkEmailCompatibility(html: string | null | undefined): EmailCompatibilityIssue[] {
  if (!html) return [];
  const issues: EmailCompatibilityIssue[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(html)) && issues.length < 50) {
      const key = `${rule.code}:${match.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ code: rule.code, severity: rule.severity, line: lineForOffset(html, match.index), index: match.index, message: rule.message });
    }
    if (issues.length >= 50) break;
  }

  return issues.sort((first, second) => first.index - second.index).slice(0, 50);
}
