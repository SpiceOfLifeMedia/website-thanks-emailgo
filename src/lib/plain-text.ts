import { convert } from 'html-to-text';

const textConverterOptions = {
  wordwrap: false as const,
  selectors: [
    { selector: 'script', format: 'skip' as const },
    { selector: 'style', format: 'skip' as const },
    { selector: 'head', format: 'skip' as const },
    { selector: '[aria-hidden=true]', format: 'skip' as const },
    { selector: '[style*="display:none"i]', format: 'skip' as const },
    { selector: '[style*="display: none"i]', format: 'skip' as const },
    { selector: '[style*="visibility:hidden"i]', format: 'skip' as const },
    { selector: '[style*="visibility: hidden"i]', format: 'skip' as const },
    { selector: 'h1', format: 'heading' as const, options: { uppercase: false } },
    { selector: 'h2', format: 'heading' as const, options: { uppercase: false } },
    { selector: 'h3', format: 'heading' as const, options: { uppercase: false } },
    { selector: 'h4', format: 'heading' as const, options: { uppercase: false } },
    { selector: 'h5', format: 'heading' as const, options: { uppercase: false } },
    { selector: 'h6', format: 'heading' as const, options: { uppercase: false } },
  ],
};

export function htmlToPlainText(html: string) {
  return convert(html, textConverterOptions)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function resolvePlainText(text: string | null | undefined, html: string | null | undefined) {
  if (text !== null && text !== undefined) return text;
  return html === null || html === undefined ? text : htmlToPlainText(html);
}
