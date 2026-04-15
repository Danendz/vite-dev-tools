/** Build a minimal diff for preview display */
export function buildDiff(original: string, patched: string, fileName: string, lineNumber: number) {
  const origLines = original.split('\n')
  const patchLines = patched.split('\n')

  let diffStart = -1
  const maxLen = Math.max(origLines.length, patchLines.length)
  for (let i = 0; i < maxLen; i++) {
    if (origLines[i] !== patchLines[i]) {
      diffStart = i
      break
    }
  }

  if (diffStart === -1) return { fileName, lineNumber, contextBefore: [] as string[], removedLines: [] as string[], addedLines: [] as string[], contextAfter: [] as string[] }

  let diffEndOrig = origLines.length - 1
  let diffEndPatch = patchLines.length - 1
  while (diffEndOrig > diffStart && diffEndPatch > diffStart && origLines[diffEndOrig] === patchLines[diffEndPatch]) {
    diffEndOrig--
    diffEndPatch--
  }

  const contextSize = 3
  return {
    fileName,
    lineNumber: diffStart + 1,
    contextBefore: origLines.slice(Math.max(0, diffStart - contextSize), diffStart),
    removedLines: origLines.slice(diffStart, diffEndOrig + 1),
    addedLines: patchLines.slice(diffStart, diffEndPatch + 1),
    contextAfter: origLines.slice(diffEndOrig + 1, diffEndOrig + 1 + contextSize),
  }
}
