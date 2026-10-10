export type VoiceMappingFailureKind =
  | 'duplicate-part-id'
  | 'conflicting-identities'
  | 'unmapped-part'
  | 'duplicate-identity'
  | 'noncanonical-profile-key'
  | 'missing-profile-range';

/** Internal detail for canonical SATB mapping failures; not part of the package root API. */
export class VoiceMappingError extends TypeError {
  readonly partIds: readonly string[];

  constructor(
    readonly kind: VoiceMappingFailureKind,
    partIds: readonly string[],
    message: string
  ) {
    super(message);
    this.name = 'VoiceMappingError';
    this.partIds = [...new Set(partIds)].sort(comparePartIds);
  }
}

function comparePartIds(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}
