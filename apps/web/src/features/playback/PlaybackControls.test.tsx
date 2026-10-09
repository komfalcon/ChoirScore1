import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  PlaybackControls,
  type PlaybackControlsProps,
} from './PlaybackControls';

type ElementProps = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: {
    currentTarget: { checked: boolean; value: string };
  }) => void;
  [key: string]: unknown;
};

function makeProps(
  overrides: Partial<PlaybackControlsProps> = {}
): PlaybackControlsProps {
  return {
    status: 'idle',
    tempoPercent: 100,
    countIn: false,
    measureCount: 4,
    loop: null,
    parts: [
      { id: 'P1', name: 'Soprano', muted: false, solo: false, volume: 0.8 },
      { id: 'P2', name: 'Alto', muted: false, solo: false, volume: 0.7 },
      { id: 'P3', name: 'Tenor', muted: false, solo: false, volume: 0.7 },
      { id: 'P4', name: 'Bass', muted: false, solo: false, volume: 0.8 },
    ],
    voicePart: 'P1',
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onStop: vi.fn(),
    onTempoPercentChange: vi.fn(),
    onCountInChange: vi.fn(),
    onLoopChange: vi.fn(),
    onPartSettingsChange: vi.fn(),
    onPreset: vi.fn(),
    ...overrides,
  };
}

function findElements(
  node: ReactNode,
  predicate: (element: ReactElement<ElementProps>) => boolean
): ReactElement<ElementProps>[] {
  const found: ReactElement<ElementProps>[] = [];
  const visit = (child: ReactNode) => {
    if (Array.isArray(child)) {
      child.forEach(visit);
      return;
    }
    if (!isValidElement(child)) return;
    const element = child as ReactElement<ElementProps>;
    if (predicate(element)) found.push(element);
    visit(element.props.children);
  };
  visit(node);
  return found;
}

function findControl(
  tree: ReactNode,
  elementType: string,
  attribute: string,
  value: string
) {
  const found = findElements(
    tree,
    (element) =>
      element.type === elementType && element.props[attribute] === value
  )[0];
  if (!found) {
    throw new Error(`Could not find ${elementType} with ${attribute}=${value}`);
  }
  return found;
}

describe('PlaybackControls', () => {
  it('renders labelled, keyboard-operable controls and the default count-in state', () => {
    const props = makeProps({ countIn: undefined });
    const html = renderToStaticMarkup(<PlaybackControls {...props} />);

    expect(html).toContain('aria-label="Playback controls"');
    expect(html).toContain('aria-label="Transport"');
    expect(html).toContain('aria-label="Play"');
    expect(html).toContain('aria-label="Pause playback"');
    expect(html).toContain('aria-label="Stop playback"');
    expect(html).toContain('aria-label="Loop start measure"');
    expect(html).toContain('aria-label="Loop end measure"');
    expect(html).toContain('aria-label="Volume Soprano"');
    expect(html).toContain('<legend>Part controls</legend>');
    expect(html).toContain('<legend>Soprano</legend>');
    expect(html).toContain('Off by default');
    expect(html).toContain('aria-valuetext="100% of score tempo"');
    expect(html).toContain('Inclusive');
    expect(html).not.toContain('checked=""');
    expect(props.countIn).toBeUndefined();
  });

  it('routes transport, tempo, and count-in input through callbacks', () => {
    const props = makeProps();
    const tree = PlaybackControls(props);
    findControl(tree, 'button', 'aria-label', 'Play').props.onClick?.();
    findControl(tree, 'input', 'id', 'playback-tempo').props.onChange?.({
      currentTarget: { checked: false, value: '125' },
    });
    const countIn = findControl(tree, 'input', 'id', 'playback-count-in');
    countIn.props.onChange?.({
      currentTarget: { checked: true, value: '' },
    });

    expect(props.onPlay).toHaveBeenCalledOnce();
    expect(props.onTempoPercentChange).toHaveBeenCalledWith(125);
    expect(props.onCountInChange).toHaveBeenCalledWith(true);
  });

  it('routes pause and stop through callbacks while playing', () => {
    const props = makeProps({ status: 'playing' });
    const tree = PlaybackControls(props);
    findControl(
      tree,
      'button',
      'aria-label',
      'Pause playback'
    ).props.onClick?.();
    findControl(
      tree,
      'button',
      'aria-label',
      'Stop playback'
    ).props.onClick?.();

    expect(props.onPause).toHaveBeenCalledOnce();
    expect(props.onStop).toHaveBeenCalledOnce();
  });

  it('keeps loop selection inclusive and clamps a crossed boundary to one measure', () => {
    const props = makeProps({
      loop: { startMeasure: 2, endMeasure: 3 },
    });
    const tree = PlaybackControls(props);
    findControl(
      tree,
      'select',
      'aria-label',
      'Loop start measure'
    ).props.onChange?.({
      currentTarget: { checked: false, value: '4' },
    });
    expect(props.onLoopChange).toHaveBeenLastCalledWith({
      startMeasure: 4,
      endMeasure: 4,
    });

    findControl(
      tree,
      'select',
      'aria-label',
      'Loop end measure'
    ).props.onChange?.({
      currentTarget: { checked: false, value: '1' },
    });
    expect(props.onLoopChange).toHaveBeenLastCalledWith({
      startMeasure: 1,
      endMeasure: 1,
    });
  });

  it('forwards volume in linear 0–1 units and mute/solo changes by actual part id', () => {
    const props = makeProps();
    const tree = PlaybackControls(props);
    findControl(tree, 'input', 'aria-label', 'Volume Alto').props.onChange?.({
      currentTarget: { checked: false, value: '35' },
    });
    findControl(tree, 'input', 'aria-label', 'Mute Alto').props.onChange?.({
      currentTarget: { checked: true, value: '' },
    });
    findControl(tree, 'input', 'aria-label', 'Solo Alto').props.onChange?.({
      currentTarget: { checked: true, value: '' },
    });

    expect(props.onPartSettingsChange).toHaveBeenNthCalledWith(1, 'P2', {
      volume: 0.35,
    });
    expect(props.onPartSettingsChange).toHaveBeenNthCalledWith(2, 'P2', {
      muted: true,
    });
    expect(props.onPartSettingsChange).toHaveBeenNthCalledWith(3, 'P2', {
      solo: true,
    });
  });

  it('keeps all playback state controlled and disables voice presets without a resolved part', () => {
    const props = makeProps({ voicePart: null });
    const tree = PlaybackControls(props);
    const html = renderToStaticMarkup(<PlaybackControls {...props} />);

    expect(html).toContain(
      'My Part presets are unavailable because no voice part is assigned.'
    );
    const myPartButtons = findElements(
      tree,
      (element) =>
        element.type === 'button' &&
        ['My Part', 'Only My Part'].includes(String(element.props.children))
    );
    expect(myPartButtons).toHaveLength(2);
    expect(
      myPartButtons.every((button) => button.props.disabled === true)
    ).toBe(true);
  });

  it('exposes preset intent through callbacks, including Only My Part', () => {
    const onPreset = vi.fn();
    const props = makeProps({ onPreset });
    const tree = PlaybackControls(props);
    const presetButtons = findElements(
      tree,
      (element) =>
        element.type === 'button' &&
        ['All', 'My Part', 'Only My Part'].includes(
          String(element.props.children)
        )
    );

    for (const button of presetButtons) button.props.onClick?.();

    expect(onPreset.mock.calls).toEqual([
      ['all'],
      ['my-part'],
      ['only-my-part'],
    ]);
  });

  it('shows playback errors and disables pause when not playing', () => {
    const props = makeProps({
      status: 'error',
      errorMessage: 'Audio could not be started.',
    });
    const html = renderToStaticMarkup(<PlaybackControls {...props} />);
    const tree = PlaybackControls(props);

    expect(html).toContain('role="alert"');
    expect(html).toContain('Audio could not be started.');
    expect(
      findControl(tree, 'button', 'aria-label', 'Pause playback').props.disabled
    ).toBe(true);
    expect(
      findControl(tree, 'button', 'aria-label', 'Retry playback').props.disabled
    ).toBe(false);
  });

  it('keeps Stop enabled while samples are loading so Play can be cancelled', () => {
    const tree = PlaybackControls(makeProps({ status: 'loading' }));

    expect(
      findControl(tree, 'button', 'aria-label', 'Stop playback').props.disabled
    ).toBe(false);
    expect(
      findControl(tree, 'button', 'aria-label', 'Play').props.disabled
    ).toBe(true);
  });
});
