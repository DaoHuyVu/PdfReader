/** Returns the PDF path Windows passes when the user opens a .pdf with this app. */
export function findPdfArg(argv: readonly string[]): string | null {
  for (let i = argv.length - 1; i >= 1; i--) {
    const arg = argv[i]
    if (!arg.startsWith('-') && arg.toLowerCase().endsWith('.pdf')) return arg
  }
  return null
}
