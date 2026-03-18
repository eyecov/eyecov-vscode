interface InsertBoundaryChange {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  text: string;
}

export function shouldPreserveStartLineOnInsert(
  currentLineText: string,
  nextLineText: string,
  change: InsertBoundaryChange,
): boolean {
  if (change.range.start.line !== change.range.end.line) {
    return false;
  }
  if (change.range.start.character !== change.range.end.character) {
    return false;
  }

  const newlineParts = change.text.split("\n");
  if (newlineParts.length !== 2) {
    return false;
  }

  // Enter at EOL leaves the current line intact and creates a next line that
  // contains only the inserted tail (often "" or indentation whitespace).
  return (
    currentLineText.length === change.range.start.character &&
    nextLineText === newlineParts[1]
  );
}

export function shouldShiftStartLineOnInsert(
  currentLineText: string,
  nextLineText: string,
  change: InsertBoundaryChange,
): boolean {
  if (change.range.start.line !== change.range.end.line) {
    return false;
  }
  if (change.range.start.character !== 0) {
    return false;
  }
  const newlineParts = change.text.split("\n");
  if (newlineParts.length !== 2) {
    return false;
  }

  const [insertedHead, insertedTail] = newlineParts;
  const insertedBlankLineOnly =
    insertedHead === "" &&
    currentLineText.trim() === "" &&
    nextLineText.startsWith(insertedTail);

  return currentLineText === insertedHead || insertedBlankLineOnly;
}
