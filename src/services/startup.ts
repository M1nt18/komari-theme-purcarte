/** Read one of the small JSON endpoints needed to start the dashboard. */
export async function readStartup<T>(
  path: "/api/public" | "/api/nodes",
  isValid: (value: unknown) => value is T,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    let retry = true;
    try {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) {
        retry = response.status >= 500 || [408, 425, 429].includes(response.status);
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (payload?.status !== "success" || !isValid(payload.data)) {
        throw new Error("Invalid dashboard API response");
      }
      return payload.data;
    } catch (error) {
      if (!retry || attempt === 1) throw error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
}
