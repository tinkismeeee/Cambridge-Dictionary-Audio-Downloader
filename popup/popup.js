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
				const title = audio.title || `Audio ${index + 1}`;
				const url = audio.url;
				const fileName = getFileNameFromUrl(url, index);

				return `
          <div class="audio-item">
            <div class="audio-title">${escapeHtml(title)}</div>
            <div class="audio-url">${escapeHtml(url)}</div>
            <div class="actions">
              <button
                class="btn btn-secondary play-on-page"
                data-url="${escapeHtml(url)}"
              >
                Play
              </button>
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

		bindPlayOnPageEvents();
	}

	async function playAudioOnCurrentPage(url) {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		if (!tab?.id) {
			throw new Error("Could not get current tab.");
		}

		await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			args: [url],
			func: (audioUrl) => {
				try {
					const existingAudio = document.getElementById(
						"cambridge-audio-downloader-player",
					);

					if (existingAudio) {
						existingAudio.pause();
						existingAudio.remove();
					}

					const audio = document.createElement("audio");
					audio.id = "cambridge-audio-downloader-player";
					audio.src = audioUrl;
					audio.autoplay = true;
					audio.controls = false;
					audio.style.display = "none";

					document.body.appendChild(audio);

					audio.play().catch((error) => {
						console.error("Playback failed:", error);
					});

					audio.addEventListener("ended", () => {
						audio.remove();
					});
				} catch (error) {
					console.error("Cannot play audio on page:", error);
				}
			},
		});
	}

	function bindPlayOnPageEvents() {
		const buttons = document.querySelectorAll(".play-on-page");

		buttons.forEach((button) => {
			button.addEventListener("click", async () => {
				const url = button.dataset.url;
				if (!url) return;

				const originalText = button.textContent;

				try {
					button.disabled = true;
					button.textContent = "Playing...";
					await playAudioOnCurrentPage(url);
					// setStatus("Audio is playing on the current page.");
				} catch (error) {
					console.error(error);
					// setStatus("Failed to play audio on the page.");
				} finally {
					setTimeout(() => {
						button.disabled = false;
						button.textContent = originalText;
					}, 1200);
				}
			});
		});
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

				document.querySelectorAll("audio[src]").forEach((el) => {
					const src = el.getAttribute("src");
					const title =
						el.getAttribute("aria-label") ||
						el.getAttribute("title") ||
						el.closest("[data-type]")?.getAttribute("data-type") ||
						"";
					if (src) pushAudio(src, title);
				});

				document.querySelectorAll('a[href*=".mp3"]').forEach((el) => {
					const href = el.getAttribute("href");
					const title =
						cleanText(el.textContent) ||
						el.getAttribute("title") ||
						"";
					if (href) pushAudio(href, title);
				});

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
