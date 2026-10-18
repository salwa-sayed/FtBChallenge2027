'use strict';

const DICTS = {};

function load(lang, dict) {
  DICTS[lang] = dict;
}

function t(lang, key, vars) {
  const dict = DICTS[lang] || DICTS.en || {};
  let s = dict[key];
  if (s === undefined) s = (DICTS.en || {})[key];
  if (s === undefined) return key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

function tCount(lang, n, vars) {
  const rule = (typeof Intl !== 'undefined' && Intl.PluralRules)
    ? new Intl.PluralRules(lang).select(n)
    : (n === 0 ? 'zero' : n === 1 ? 'one' : 'other');
  const key = `clue.count.${rule}`;
  const dict = DICTS[lang] || {};
  const finalKey = dict[key] !== undefined ? key
    : (n === 0 ? 'clue.count.zero' : n === 1 ? 'clue.count.one' : 'clue.count.other');
  return t(lang, finalKey, { ...vars, n });
}

const api = { load, t, tCount, DICTS };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.i18n = api;
}