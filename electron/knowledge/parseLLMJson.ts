export function extractJsonCandidate(response: string): string {
  let jsonStr = response.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }
  return jsonStr;
}

export function parseLLMJson<T = any>(response: string): T {
  const jsonStr = extractJsonCandidate(response);

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch && objMatch[0] !== jsonStr) {
      return JSON.parse(objMatch[0]) as T;
    }
    throw new Error('Failed to parse LLM response as JSON');
  }
}
