export function modelFamily(modelId: string): string {
  return modelId.toLowerCase().split(/[-/]/, 1)[0] || "ampersand-bridge";
}
