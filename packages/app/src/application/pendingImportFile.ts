// Transfer a dropped file between routes without persisting it or copying its contents.
let pendingFile: File | undefined

export function setPendingImportFile(file: File): void {
  pendingFile = file
}

export function takePendingImportFile(): File | undefined {
  const file = pendingFile
  pendingFile = undefined
  return file
}
