document.addEventListener("DOMContentLoaded", async () => {
	const statusEl = document.getElementById("status");
	const audioListEl = document.getElementById("audioList");

	function setStatus(message) {
		statusEl.textContent = message;
	}

	function escapeHtml(str) {
		return String(str).replace(/[&<>"']/g, (char) => {
			const map = {
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			};
			return map[char];
		});
	}

	function getFileNameFromUrl(url, index) {
		try {
			const parsed = new URL(url);
			const pathname = parsed.pathname;
			const name = pathname.split("/").pop();

			if (name && name.trim()) {
				return decodeURIComponent(name);
			}
		} catch (error) {
			console.warn("Can't parse URL:", url, error);
		}

		return `audio-${index + 1}.mp3`;
	}

	function renderEmptyState() {
		audioListEl.innerHTML = `
      <div class="empty">
        No MP3 audio found on the current page.
      </div>
    `;
	}

	function renderAudioList(audios) {
		if (!audios.length) {
			renderEmptyState();
			return;
		}

		audioListEl.innerHTML = audios
			.map((audio, index) => {
				const title = `Audio ${index + 1}`;
				const url = audio.url;
				const fileName = getFileNameFromUrl(url, index);

				return `
          <div class="audio-item">
            <div class="audio-title">${escapeHtml(title)}</div>
            <div class="audio-url">${escapeHtml(url)}</div>
            <audio class="audio-player" controls src="${escapeHtml(url)}"></audio>
            <div class="actions">
              <a
                class="btn btn-primary"
                href="${escapeHtml(url)}"
                download="${escapeHtml(fileName)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                Download
              </a>
              <a
                class="btn btn-secondary"
                href="${escapeHtml(url)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Link
              </a>
            </div>
          </div>
        `;
			})
			.join("");
	}

	try {
		setStatus("Getting current tab...");

		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		if (!tab?.id) {
			throw new Error("Could not get current tab.");
		}

		setStatus("Scanning audio on the page...");

		const results = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				function absoluteUrl(url) {
					try {
						return new URL(url, window.location.origin).href;
					} catch {
						return null;
					}
				}

				function cleanText(text) {
					return (text || "").replace(/\s+/g, " ").trim();
				}

				const collected = [];

				function pushAudio(url, title = "") {
					const fullUrl = absoluteUrl(url);
					if (!fullUrl) return;
					if (
						!/\.mp3(\?|#|$)/i.test(fullUrl) &&
						!fullUrl.includes(".mp3")
					)
						return;

					collected.push({
						url: fullUrl,
						title: cleanText(title),
					});
				}

				// 1) <source type="audio/mpeg" src="...">
				document
					.querySelectorAll('source[type="audio/mpeg"]')
					.forEach((el) => {
						const src = el.getAttribute("src");
						const parentAudio = el.closest("audio");
						const title =
							parentAudio?.getAttribute("aria-label") ||
							parentAudio?.getAttribute("title") ||
							parentAudio
								?.closest("[data-type]")
								?.getAttribute("data-type") ||
							"";
						if (src) pushAudio(src, title);
					});

				// 2) <audio src="...">
				document.querySelectorAll("audio[src]").forEach((el) => {
					const src = el.getAttribute("src");
					const title =
						el.getAttribute("aria-label") ||
						el.getAttribute("title") ||
						el.closest("[data-type]")?.getAttribute("data-type") ||
						"";
					if (src) pushAudio(src, title);
				});

				// 3) <a href="...mp3">
				document.querySelectorAll('a[href*=".mp3"]').forEach((el) => {
					const href = el.getAttribute("href");
					const title =
						cleanText(el.textContent) ||
						el.getAttribute("title") ||
						"";
					if (href) pushAudio(href, title);
				});

				// 4) dedupe
				const uniqueMap = new Map();

				collected.forEach((item, index) => {
					if (!uniqueMap.has(item.url)) {
						uniqueMap.set(item.url, {
							url: item.url,
							title: item.title || `Audio ${index + 1}`,
						});
					}
				});

				return Array.from(uniqueMap.values());
			},
		});

		const audios = results?.[0]?.result || [];

		renderAudioList(audios);
		setStatus(`Found ${audios.length} MP3 audio files.`);
	} catch (error) {
		console.error(error);
		setStatus("An error occurred while scanning for audio.");
		audioListEl.innerHTML = `
      <div class="empty">
        Cannot retrieve audio from this page.<br>
        <small>${escapeHtml(error.message || "Undefined error")}</small>
      </div>
    `;
	}
});
