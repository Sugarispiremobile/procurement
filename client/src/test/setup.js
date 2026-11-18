import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom не знает matchMedia; «уменьшенное движение» включено, чтобы счётчики сразу показывали итог
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
}

afterEach(() => { cleanup(); localStorage.clear(); });
