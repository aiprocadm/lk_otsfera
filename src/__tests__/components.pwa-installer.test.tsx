// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { PwaInstaller } from '@/components/pwa-installer';

describe('PwaInstaller', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    // Restore navigator.serviceWorker between tests (jsdom doesn't define it by default).
    // @ts-expect-error -- test cleanup of a jsdom-absent property
    delete navigator.serviceWorker;
  });

  it('renders nothing (returns null)', () => {
    const { container } = render(React.createElement(PwaInstaller));
    expect(container.innerHTML).toBe('');
  });

  it('when serviceWorker is not in navigator: does not attempt registration', () => {
    // jsdom's navigator has no serviceWorker property by default, so this is the baseline.
    expect('serviceWorker' in navigator).toBe(false);
    render(React.createElement(PwaInstaller));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('registration success: calls navigator.serviceWorker.register with /sw.js and updateViaCache=none', async () => {
    const register = vi.fn().mockResolvedValue({ scope: '/' });
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });

    render(React.createElement(PwaInstaller));

    expect(register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
    await Promise.resolve();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('registration failure: logs via console.warn, does not throw', async () => {
    const err = new Error('registration failed');
    const register = vi.fn().mockRejectedValue(err);
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });

    render(React.createElement(PwaInstaller));

    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith('[pwa] service worker registration failed', err));
  });
});
