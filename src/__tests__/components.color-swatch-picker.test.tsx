// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ColorSwatchPicker, COLOR_SWATCH_PRESETS } from '@/components/ui';

/**
 * jsdom normalizes hex assigned to the `background` shorthand (e.g. into
 * rgb(...)); `swatchStyle` below compares against the same normalization
 * instead of the raw hex.
 */
function swatchOf(radio: HTMLElement): HTMLElement {
  return radio.parentElement!.querySelector('span[aria-hidden]') as HTMLElement;
}

describe('ColorSwatchPicker', () => {
  it('renders a radiogroup labelled «Цвет» with 8 preset swatches + «Без цвета», all radios sharing the given name', () => {
    render(React.createElement(ColorSwatchPicker, { name: 'color', value: null }));
    expect(screen.getByRole('radiogroup', { name: 'Цвет' })).toBeTruthy();

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(COLOR_SWATCH_PRESETS.length + 1);
    expect(radios.every((r) => r.name === 'color')).toBe(true);

    // «Без цвета» submits an empty string (the actions map '' → null).
    const none = screen.getByRole('radio', { name: 'Без цвета' }) as HTMLInputElement;
    expect(none.value).toBe('');
    for (const hex of COLOR_SWATCH_PRESETS) {
      const radio = screen.getByRole('radio', { name: `Цвет ${hex}` }) as HTMLInputElement;
      expect(radio.value).toBe(hex);
      expect(swatchOf(radio).getAttribute('style')).toBe(swatchStyle(hex));
    }
  });

  it('value=null → «Без цвета» is the default-checked radio, no colored radio is checked', () => {
    render(React.createElement(ColorSwatchPicker, { name: 'color', value: null }));
    const none = screen.getByRole('radio', { name: 'Без цвета' }) as HTMLInputElement;
    expect(none.checked).toBe(true);
    const others = (screen.getAllByRole('radio') as HTMLInputElement[]).filter((r) => r !== none);
    expect(others.some((r) => r.checked)).toBe(false);
  });

  it('value matching a preset → that preset radio is checked, «Без цвета» is not', () => {
    render(React.createElement(ColorSwatchPicker, { name: 'color', value: '#22C55E' }));
    expect((screen.getByRole('radio', { name: 'Цвет #22C55E' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Без цвета' }) as HTMLInputElement).checked).toBe(false);
  });

  it('preset matching is case-insensitive: a lowercase stored value checks the preset without adding an extra swatch', () => {
    render(React.createElement(ColorSwatchPicker, { name: 'color', value: '#3b82f6' }));
    expect(screen.getAllByRole('radio')).toHaveLength(COLOR_SWATCH_PRESETS.length + 1);
    expect((screen.getByRole('radio', { name: 'Цвет #3B82F6' }) as HTMLInputElement).checked).toBe(true);
  });

  it('non-preset stored value → rendered as an extra checked swatch (data preserved on resubmit)', () => {
    render(React.createElement(ColorSwatchPicker, { name: 'color', value: '#123456' }));
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(COLOR_SWATCH_PRESETS.length + 2);
    const custom = screen.getByRole('radio', { name: 'Цвет #123456' }) as HTMLInputElement;
    expect(custom.checked).toBe(true);
    expect(custom.value).toBe('#123456');
    expect(swatchOf(custom).getAttribute('style')).toBe(swatchStyle('#123456'));
  });

  it('«Без цвета» swatch is visually distinct: gray circle with a strike-through decoration', () => {
    render(React.createElement(ColorSwatchPicker, { name: 'color', value: null }));
    const none = screen.getByRole('radio', { name: 'Без цвета' }) as HTMLInputElement;
    const swatch = swatchOf(none);
    expect(swatch.getAttribute('style')).toBeNull(); // no data-driven background
    expect(swatch.querySelector('span')).toBeTruthy(); // the strike line
  });
});

/** Serialized style attribute React produces for `style={{ background: hex }}`. */
function swatchStyle(hex: string): string {
  const probe = document.createElement('div');
  probe.style.background = hex;
  return probe.getAttribute('style')!;
}
