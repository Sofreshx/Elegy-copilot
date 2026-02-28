import { ReactNode } from 'react';

export type DataTableRow = Record<string, unknown>;

export interface DataTableColumn {
  key: string;
  header: string;
  align?: 'left' | 'center' | 'right';
  render?: (row: DataTableRow) => string | number | boolean | null | undefined;
}

interface DataTableProps {
  columns?: DataTableColumn[];
  rows?: DataTableRow[];
  caption?: string;
  emptyMessage?: string;
  testId?: string;
}

function readCellValue(row: DataTableRow, column: DataTableColumn): ReactNode {
  const raw = column.render ? column.render(row) : row[column.key];

  if (raw === null || raw === undefined || raw === '') {
    return '-';
  }

  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return '[object]';
    }
  }

  return String(raw);
}

export default function DataTable({
  columns = [],
  rows = [],
  caption = '',
  emptyMessage = 'No rows to display.',
  testId = 'ui-data-table',
}: DataTableProps) {
  return (
    <div className="table-wrap" data-testid={testId}>
      <table>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={`align-${column.align ?? 'left'}`} key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="empty-cell" colSpan={Math.max(columns.length, 1)}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`${String(row.id ?? index)}`}>
                {columns.map((column) => (
                  <td className={`align-${column.align ?? 'left'}`} key={`${String(row.id ?? index)}-${column.key}`}>
                    {readCellValue(row, column)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
