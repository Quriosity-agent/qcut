import { handleNetworkError, ErrorSeverity } from "./error-handler";

export async function getStars(): Promise<string> {
  try {
    let count: number;

    // Check if we're in Electron environment
    if (typeof window !== "undefined" && window.electronAPI?.github) {
      // Use IPC to fetch GitHub stars through Electron main process
      const result = await window.electronAPI.github.fetchStars();
      count = result.stars || 0;
    } else {
      // Fallback to direct fetch (for web/dev environment)
      const res = await fetch(
        "https://api.github.com/repos/donghaozhang/qcut",
        {
          // Remove problematic Cache-Control header
          headers: {
            "Accept": "application/vnd.github.v3+json",
          },
        }
      );

      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as { stargazers_count: number };
      count = data.stargazers_count;
    }

    if (typeof count !== "number") {
      throw new Error("Invalid stargazers_count from GitHub API");
    }

    if (count >= 1_000_000)
      return (count / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (count >= 1000)
      return (count / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return count.toString();
  } catch (error) {
    handleNetworkError(
      error,
      "Fetch GitHub Stars",
      {
        repository: "donghaozhang/qcut",
        severity: ErrorSeverity.LOW,
        showToast: false // Don't show toast for non-critical UI data
      }
    );
    return "1.5k"; // Return fallback value
  }
}
