const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const localesRoot = path.join(repoRoot, '_locales');
const englishMessages = JSON.parse(fs.readFileSync(path.join(localesRoot, 'en', 'messages.json'), 'utf8'));

const SETTINGS_LANGUAGE_KEYS = [
  'languageSettingsTitle',
  'settingsNavShortcutsTitle',
  'settingsNavSkillsTitle',
  'promptTemplatesTitle',
  'analysisPromptTemplatesTitle',
  'settingsNavSyncTitle',
  'settingsNavLanguageTitle'
];

test('non-English locales localize settings language navigation copy', () => {
  const localeDirs = fs.readdirSync(localesRoot)
    .filter((locale) => !/^en(?:_|$)/.test(locale))
    .filter((locale) => fs.existsSync(path.join(localesRoot, locale, 'messages.json')));

  const untranslated = [];

  localeDirs.forEach((locale) => {
    const messages = JSON.parse(fs.readFileSync(path.join(localesRoot, locale, 'messages.json'), 'utf8'));
    SETTINGS_LANGUAGE_KEYS.forEach((key) => {
      const localized = String(messages?.[key]?.message || '').trim();
      const english = String(englishMessages?.[key]?.message || '').trim();
      if (!localized || localized === english) {
        untranslated.push(`${locale}.${key}`);
      }
    });
  });

  assert.deepEqual(untranslated, []);
});
