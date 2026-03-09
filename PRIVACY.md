# Privacy Policy — LovableGrab

**Last updated:** March 2026

## Overview

LovableGrab is a browser extension that exports source code from **your own** Lovable.dev projects. It does **not** collect, store, or transmit any personal data.

## Data Handling

| Data type | Collected? | Sent externally? |
|-----------|-----------|-----------------|
| Auth tokens (Firebase) | Used in-memory only | Sent **only** to `lovable-api.com` for project export |
| Project source code | Downloaded to your device | Never sent elsewhere |
| Browsing history | No | No |
| Cookies | No | No |
| Personal information | No | No |

## How It Works

1. The extension reads your existing authentication token from the Lovable.dev page.
2. It uses that token to call the official Lovable API (`https://lovable-api.com/api/`) to request a source code export.
3. The exported ZIP archive is downloaded directly to your device.

**No data is ever sent to any third-party servers.**  
**No analytics or tracking is included.**

## Permissions Explained

| Permission | Why it's needed |
|-----------|----------------|
| `activeTab` | Read the current tab URL to extract the project ID |
| `scripting` | Inject the export helper script into the Lovable.dev page |
| `host_permissions: lovable.dev/*` | Access the Lovable project page |
| `host_permissions: lovable-api.com/*` | Call the Lovable API to export source code |

## Contact

If you have questions about this privacy policy, please open an issue at:  
https://github.com/unchase/lovable-grab/issues

## Changes

Any changes to this policy will be reflected in this document with an updated date.
