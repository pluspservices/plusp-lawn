export async function fetchTimeout(url, options = {}, ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
