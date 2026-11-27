'use client';

import { useDeferredValue, useMemo } from 'react';
import { checkEmailCompatibility } from '@/lib/email-compatibility-checker';
import styles from './email-compatibility-panel.module.css';

export function EmailCompatibilityPanel({ html }: { html: string }) {
  const checkedHtml = useDeferredValue(html);
  const issues = useMemo(() => checkEmailCompatibility(checkedHtml), [checkedHtml]);

  if (!html.trim()) return null;

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  const summary = issues.length === 0
    ? 'No common compatibility issues found'
    : [errors ? `${errors} likely removal${errors === 1 ? '' : 's'}` : '', warnings ? `${warnings} support note${warnings === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');

  return <section className={styles.panel} aria-label="Email compatibility check">
    <div className={styles.header}>
      <strong role="status" aria-live="polite">{summary}</strong>
      <p>Checks run as you edit. These common-pattern hints are advisory and do not guarantee how every inbox will render.</p>
    </div>
    {issues.length > 0 && <ol className={styles.list} aria-label="Compatibility findings">
      {issues.map((issue, index) => <li className={styles.issue} data-severity={issue.severity} key={`${issue.code}-${issue.line}-${index}`}>
        <span className={styles.label}>{issue.severity === 'error' ? 'May be removed' : 'Check support'}</span>
        <span>{issue.message}</span>
        <code>Line {issue.line}</code>
      </li>)}
    </ol>}
  </section>;
}
