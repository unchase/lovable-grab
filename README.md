# LovableGrab

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

![Logo](/chrome/icons/icon128.svg)

> Export source code from your [Lovable.dev](https://lovable.dev/) projects — one click, zero hassle.

No GitHub integration needed. No manual copy-paste.  
Just open your project, click the button, and get a ready-to-use ZIP archive.

## ✨ What it does

- **Full project export** — grab all source files as a single `.zip` via the toolbar button
- **Individual file / folder export** — download specific items directly from the file tree
- **Popup download** — click the extension icon for a quick project export
- **Works with 3rd-party auth** — supports Google, GitHub, and email/password sign-in

## 🚀 Installation

### Chrome Extension (recommended)

1. Clone this repository:
   ```bash
   git clone https://github.com/unchase/lovable-downloader.git
   ```
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `chrome` folder
5. Navigate to any Lovable project and start exporting!

> [!NOTE]
> If you signed in via Google or GitHub, use the **in-page toolbar button** for the most reliable experience.

### Tampermonkey

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Create a new script and paste the contents of [`tampermonkey/tampermonkey.js`](tampermonkey/tampermonkey.js)
3. Save and reload any Lovable project page

## 🛡️ Privacy

This extension does **not** collect, store, or transmit any personal data.  
All operations happen locally in your browser.

## 📄 License

[MIT](LICENSE) © unchase
