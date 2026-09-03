import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { onHostConfig } from './sdk/mnemo-sdk';
import App from './App';
import { adoptHostLang } from './i18n/useI18n';
import './styles.css';

/**
 * One subscription to the shell, for everything it broadcasts.
 *
 * By default `onHostConfig` also APPLIES what it receives: the host's theme
 * lands on `<html data-theme>` and its design tokens land as inline custom
 * properties, so the reader follows the shell's look and the user's own colours
 * without a line of CSS here. The callback adds the one thing it cannot apply
 * for us — the UI language.
 *
 * 🚨 The language of the INTERFACE, and nothing else. The language the book is
 * READ in comes from the text itself (lib/lang.ts), never from this: someone
 * runs Mnemosyne in Spanish and listens to an English novel, and both must be
 * right at once.
 *
 * Registered before render so the first paint is already themed and translated.
 */
onHostConfig((cfg) => adoptHostLang(cfg.lang));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
