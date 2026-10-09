import type {
  PartVoiceRange,
  VoicePartId,
  VoicePartRanges,
} from '@choirscore/shared';

const PART_LABELS: Record<VoicePartId, string> = {
  S: 'Soprano',
  A: 'Alto',
  T: 'Tenor',
  B: 'Bass',
};

type RangeKind = keyof PartVoiceRange;
type Endpoint = 'low' | 'high';

export function updateVoiceRangeEndpoint(
  ranges: VoicePartRanges,
  partId: VoicePartId,
  rangeKind: RangeKind,
  endpoint: Endpoint,
  value: string
): VoicePartRanges {
  return {
    ...ranges,
    [partId]: {
      ...ranges[partId],
      [rangeKind]: {
        ...ranges[partId][rangeKind],
        [endpoint]: value,
      },
    },
  };
}

export type VoiceRangesEditorProps = {
  ranges: VoicePartRanges;
  disabled?: boolean;
  onChange: (ranges: VoicePartRanges) => void;
};

export function VoiceRangesEditor({
  ranges,
  disabled = false,
  onChange,
}: VoiceRangesEditorProps) {
  return (
    <div className="voice-ranges-editor">
      <p className="voice-ranges-editor__help" id="voice-ranges-help">
        Enter scientific pitch names such as C4 or F#5. Comfortable ranges must
        stay within each part’s hard limit.
      </p>
      <div
        className="voice-ranges-editor__table-scroll"
        role="region"
        aria-label="Editable voice ranges"
        tabIndex={0}
      >
        <table className="voice-ranges-editor__table">
          <caption>Comfortable and hard range endpoints by voice part</caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                Voice part
              </th>
              <th scope="colgroup" colSpan={2}>
                Comfortable range
              </th>
              <th scope="colgroup" colSpan={2}>
                Hard limit
              </th>
            </tr>
            <tr>
              <th scope="col">Low</th>
              <th scope="col">High</th>
              <th scope="col">Low</th>
              <th scope="col">High</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(PART_LABELS) as VoicePartId[]).map((partId) => {
              const renderEndpoint = (
                rangeKind: RangeKind,
                endpoint: Endpoint
              ) => {
                const fieldId = `voice-range-${partId}-${rangeKind}-${endpoint}`;
                const label = `${PART_LABELS[partId]} ${rangeKind} range ${endpoint === 'low' ? 'lower' : 'upper'} endpoint`;
                return (
                  <td key={fieldId}>
                    <label className="sr-only" htmlFor={fieldId}>
                      {label}
                    </label>
                    <input
                      id={fieldId}
                      type="text"
                      autoComplete="off"
                      maxLength={8}
                      aria-describedby="voice-ranges-help"
                      value={ranges[partId][rangeKind][endpoint]}
                      disabled={disabled}
                      onChange={(event) =>
                        onChange(
                          updateVoiceRangeEndpoint(
                            ranges,
                            partId,
                            rangeKind,
                            endpoint,
                            event.currentTarget.value
                          )
                        )
                      }
                    />
                  </td>
                );
              };

              return (
                <tr key={partId}>
                  <th scope="row">
                    <span className="voice-ranges-editor__part-id">
                      {partId}
                    </span>
                    <span>{PART_LABELS[partId]}</span>
                  </th>
                  {renderEndpoint('comfortable', 'low')}
                  {renderEndpoint('comfortable', 'high')}
                  {renderEndpoint('hard', 'low')}
                  {renderEndpoint('hard', 'high')}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
