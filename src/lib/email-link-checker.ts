export type EmailLinkIssue = {
  source: 'html' | 'text';
  index: number;
  code: 'missing_href' | 'empty_href' | 'placeholder' | 'invalid_url' | 'unsafe_scheme';
  message: string;
};

const allowedDynamicVariables = new Set(['unsubscribe_url', 'preferences_url', 'UNSUBSCRIBE_URL', 'RESEND_UNSUBSCRIBE_URL']);
const placeholderHosts = new Set(['example.com', 'example.org', 'example.net', 'localhost', '127.0.0.1']);

function addIssue(issues: EmailLinkIssue[], source: EmailLinkIssue['source'], index: number, code: EmailLinkIssue['code'], message: string) {
  if (issues.length < 50) issues.push({ source, index, code, message });
}

function inspectHref(hrefValue: string, source: EmailLinkIssue['source'], index: number, issues: EmailLinkIssue[], fallbacks: ReadonlyMap<string, string | number | null>) {
  const href = hrefValue.trim();
  if (!href) { addIssue(issues, source, index, 'empty_href', 'Link destination is empty.'); return; }
  if (href.startsWith('#')) { addIssue(issues, source, index, 'placeholder', 'Replace the placeholder link with a destination.'); return; }
  const variable = /^{{\s*([A-Za-z_][A-Za-z0-9_.-]{0,99})\s*}}$/.exec(href);
  if (variable) {
    const key = variable[1];
    if (allowedDynamicVariables.has(key)) return;
    if (!fallbacks.has(key)) { addIssue(issues, source, index, 'placeholder', 'Provide a URL value for this link variable.'); return; }
    const fallback = fallbacks.get(key);
    if (fallback === null || fallback === undefined || fallback === '') return;
    inspectHref(String(fallback), source, index, issues, new Map());
    return;
  }
  if (href.includes('{{') || href.includes('}}') || /\b(?:your[-_ ]?(?:url|link|website)|replace[-_ ]?me|placeholder)\b/i.test(href)) {
    addIssue(issues, source, index, 'placeholder', 'Replace the unfinished link placeholder.');
    return;
  }
  const normalized = href.replace(/&amp;/gi, '&');
  if (/^www\./i.test(normalized)) {
    inspectHref(`https://${normalized}`, source, index, issues, fallbacks);
    return;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)?.[1]?.toLowerCase();
  if (!scheme) { addIssue(issues, source, index, 'invalid_url', 'Use an absolute web, email, or phone link.'); return; }
  if (!['http', 'https', 'mailto', 'tel'].includes(scheme)) { addIssue(issues, source, index, 'unsafe_scheme', 'This link type is not allowed in an email.'); return; }
  try {
    const url = new URL(normalized);
    if (scheme === 'http' || scheme === 'https') {
      const host = url.hostname.toLowerCase();
      if (!host || placeholderHosts.has(host) || host.endsWith('.example') || host.includes('placeholder')) {
        addIssue(issues, source, index, 'placeholder', 'Replace the example host with your real destination.');
      }
      return;
    }
    if (scheme === 'mailto' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decodeURIComponent(url.pathname))) {
      addIssue(issues, source, index, 'invalid_url', 'Enter a valid email address for this link.');
    } else if (scheme === 'tel' && !/^[+0-9(). -]{3,40}$/.test(decodeURIComponent(url.pathname))) {
      addIssue(issues, source, index, 'invalid_url', 'Enter a valid phone number for this link.');
    }
  } catch {
    addIssue(issues, source, index, 'invalid_url', 'This link destination is not a valid URL.');
  }
}

export function checkEmailLinks(html: string | null | undefined, text: string | null | undefined, variableFallbacks: ReadonlyMap<string, string | number | null> = new Map()): EmailLinkIssue[] {
  const issues: EmailLinkIssue[] = [];
  if (html) {
    const anchors = /<a\b([^>]*)>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchors.exec(html)) && issues.length < 50) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(match[1]);
      if (!href) addIssue(issues, 'html', match.index, 'missing_href', 'Add a destination to this link.');
      else inspectHref(href[1] ?? href[2] ?? href[3] ?? '', 'html', match.index, issues, variableFallbacks);
    }
  }
  if (text && issues.length < 50) {
    const links = /\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)|\b(?:https?:\/\/|www\.)[^\s<>()"']+/gi;
    let match: RegExpExecArray | null;
    while ((match = links.exec(text)) && issues.length < 50) {
      let href = match[1] ?? match[0];
      if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
      href = href.replace(/[.,!?;:]+$/, '');
      inspectHref(href, 'text', match.index, issues, variableFallbacks);
    }
  }
  return issues;
}
