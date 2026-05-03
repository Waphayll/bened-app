function renderCellValue(row, column, rowIndex) {
  if (typeof column.render === 'function') {
    return column.render(row, rowIndex);
  }

  const value = row?.[column.key];
  return value === undefined || value === null || value === '' ? 'N/A' : value;
}

export default function SpreadsheetGrid({
  columns,
  rows,
  getRowKey,
  rowClassName,
  className = '',
}) {
  const columnTemplate = columns.map((column) => column.width || 'minmax(140px, 1fr)').join(' ');

  return (
    <div
      className={`spreadsheet-grid ${className}`.trim()}
      style={{ '--spreadsheet-columns': columnTemplate }}
      role="table"
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length}
    >
      <div className="spreadsheet-grid-row spreadsheet-grid-row-head" role="row">
        {columns.map((column) => (
          <div
            key={column.key}
            role="columnheader"
            className={[
              'spreadsheet-grid-cell',
              'spreadsheet-grid-cell-head',
              column.align === 'end' ? 'is-numeric' : '',
              column.sticky === 'right' ? 'is-sticky-right' : '',
            ].filter(Boolean).join(' ')}
          >
            {column.label}
          </div>
        ))}
      </div>

      {rows.map((row, rowIndex) => (
        <div
          key={getRowKey(row, rowIndex)}
          role="row"
          className={[
            'spreadsheet-grid-row',
            typeof rowClassName === 'function' ? rowClassName(row, rowIndex) : '',
          ].filter(Boolean).join(' ')}
        >
          {columns.map((column) => (
            <div
              key={column.key}
              role="cell"
              className={[
                'spreadsheet-grid-cell',
                column.align === 'end' ? 'is-numeric' : '',
                column.sticky === 'right' ? 'is-sticky-right' : '',
              ].filter(Boolean).join(' ')}
            >
              {renderCellValue(row, column, rowIndex)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
