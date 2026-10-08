export interface CredentialExportRow {
  displayName: string;
  username: string;
  password: string;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function credentialsToCsv(rows: CredentialExportRow[]) {
  const header = ['Display name', 'Username', 'Password'];
  const records = [
    header,
    ...rows.map((row) => [row.displayName, row.username, row.password]),
  ];
  return `\uFEFF${records.map((record) => record.map(csvCell).join(',')).join('\r\n')}`;
}
