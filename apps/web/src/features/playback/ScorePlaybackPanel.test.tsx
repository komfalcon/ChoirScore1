import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { scoreDetailResponse } from '../../test/scoreFixtures';
import { ScorePlaybackPanel } from './ScorePlaybackPanel';

describe('ScorePlaybackPanel', () => {
  it('renders controls without initializing audio and keeps count-in off by default', () => {
    const html = renderToStaticMarkup(
      <ScorePlaybackPanel
        score={scoreDetailResponse.score.model}
        profileVoicePart="S"
      />
    );

    expect(html).toContain('aria-labelledby="score-playback-title"');
    expect(html).toContain('1-measure count-in');
    expect(html).toContain('Off by default');
    const countInInput = html.match(
      /<input\b[^>]*id="playback-count-in"[^>]*>/
    )?.[0];
    expect(countInInput).toBeDefined();
    expect(countInInput).not.toContain('checked');
    expect(html).toContain('Only My Part');
    expect(html).toContain('Mute Soprano');
    expect(html).toContain('Volume Soprano');
    expect(html).toContain('Audio and samples load only when you press Play.');
  });

  it('does not resolve a profile assignment when there is no unique matching part', () => {
    const html = renderToStaticMarkup(
      <ScorePlaybackPanel
        score={scoreDetailResponse.score.model}
        profileVoicePart="none"
      />
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain(
      'My Part presets are unavailable because no voice part is assigned.'
    );
  });
});
