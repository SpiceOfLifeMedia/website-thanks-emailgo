import assert from 'node:assert/strict';
import { test } from 'node:test';
import { broadcastContactVariables, renderBroadcastContent } from '../src/lib/broadcast-template.ts';
import { checkEmailLinks } from '../src/lib/email-link-checker.ts';

test('broadcast variables expose contact names and email fields plus neutral preference links', () => {
  assert.deepEqual(broadcastContactVariables({
    properties: { plan: 'plus', EMAIL: 'custom@example.test' },
    email: 'sam@example.test',
    name: 'Sam Leverenz',
    preferencesUrl: 'https://example.test/preferences/token',
    unsubscribeUrl: 'https://example.test/unsubscribe/token',
  }), {
    plan: 'plus',
    EMAIL: 'sam@example.test',
    email: 'sam@example.test',
    name: 'Sam Leverenz',
    first_name: 'Sam',
    last_name: 'Leverenz',
    preferences_url: 'https://example.test/preferences/token',
    unsubscribe_url: 'https://example.test/unsubscribe/token',
    FIRST_NAME: 'Sam',
    LAST_NAME: 'Leverenz',
    PREFERENCES_URL: 'https://example.test/preferences/token',
    UNSUBSCRIBE_URL: 'https://example.test/unsubscribe/token',
  });
});

test('broadcast fallback syntax applies when values are missing or null', () => {
  const rendered = renderBroadcastContent('Hi {{{FIRST_NAME|there}}}, {{{PLAN|free tier}}}.', { FIRST_NAME: null, PLAN: undefined }, false);
  assert.equal(rendered, 'Hi there, free tier.');
});

test('provided empty, false, zero and other values take precedence over fallbacks', () => {
  const rendered = renderBroadcastContent('{{EMPTY|fallback}}/{{COUNT|fallback}}/{{ACTIVE|fallback}}/{{MISSING|fallback}}', {
    EMPTY: '', COUNT: 0, ACTIVE: false,
  }, false);
  assert.equal(rendered, '/0/false/fallback');
});

test('HTML merge tags escape double braces and preserve explicit triple-brace markup', () => {
  const rendered = renderBroadcastContent('<p>{{NAME}}</p><p>{{{HTML}}}</p><a href="{{URL|https://example.test}}">Read</a>', {
    NAME: '<Sam & friends>', HTML: '<strong>Welcome</strong>',
  }, true);
  assert.equal(rendered, '<p>&lt;Sam &amp; friends&gt;</p><p><strong>Welcome</strong></p><a href="https://example.test">Read</a>');
});

test('rendered broadcast URL fallbacks pass link checks and unsafe schemes are rejected', () => {
  const safe = renderBroadcastContent('<a href="{{{CTA_URL|https://example.test/updates}}}">Read</a>', {}, true);
  const unsafe = renderBroadcastContent('<a href="{{{CTA_URL|javascript:alert(1)}}}">Read</a>', {}, true);
  assert.deepEqual(checkEmailLinks(safe, null), []);
  assert.equal(checkEmailLinks(unsafe, null)[0]?.code, 'unsafe_scheme');
});

test('subject and text fallbacks render and absent optional sources remain null', () => {
  assert.equal(renderBroadcastContent('Hello {{FIRST_NAME|friend}}', {}, false), 'Hello friend');
  assert.equal(renderBroadcastContent(null, {}, false), null);
});
