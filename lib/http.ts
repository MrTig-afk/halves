// The one error shape every API route answers with. `retryable` tells the client whether the
// same request could succeed if sent again; `until` is when a paused feature works again.
export const fail = (status: number, error: string, message: string, retryable = false, until?: string) =>
  Response.json({ error, message, retryable, ...(until && { until }) }, { status });
