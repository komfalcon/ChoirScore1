import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_RANGES } from '@choirscore/shared';
import {
  updateVoiceRangeEndpoint,
  VoiceRangesEditor,
} from './VoiceRangesEditor';

describe('VoiceRangesEditor', () => {
  it('renders editable, labelled comfortable and hard endpoints with the defaults', () => {
    const html = renderToStaticMarkup(
      <VoiceRangesEditor ranges={DEFAULT_VOICE_RANGES} onChange={vi.fn()} />
    );

    expect(html).toContain(
      'Comfortable and hard range endpoints by voice part'
    );
    expect(html).toContain('Soprano comfortable range lower endpoint');
    expect(html).toContain('Bass hard range upper endpoint');
    expect(html).toContain('value="C4"');
    expect(html).toContain('value="G5"');
    expect(html).toContain('value="D2"');
    expect(html).toContain('value="F4"');
    expect(html).toContain('aria-describedby="voice-ranges-help"');
    expect(html).not.toContain('disabled=""');
  });

  it('disables all inputs while a save is in progress', () => {
    const html = renderToStaticMarkup(
      <VoiceRangesEditor
        ranges={DEFAULT_VOICE_RANGES}
        disabled
        onChange={vi.fn()}
      />
    );

    expect(html.match(/disabled=""/g)).toHaveLength(16);
  });

  it('updates one endpoint immutably without changing the centralized defaults', () => {
    const updated = updateVoiceRangeEndpoint(
      DEFAULT_VOICE_RANGES,
      'S',
      'comfortable',
      'low',
      'D4'
    );

    expect(updated.S.comfortable.low).toBe('D4');
    expect(updated.S.comfortable.high).toBe('G5');
    expect(DEFAULT_VOICE_RANGES.S.comfortable.low).toBe('C4');
    expect(updated.A).toEqual(DEFAULT_VOICE_RANGES.A);
  });
});
