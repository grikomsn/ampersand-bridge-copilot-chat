---
"ampersand-bridge-copilot-chat": major
---

Native entries no longer require an `entryId`: the group name you type in Manage Language Models is the entry's identity, and only the API key is prompted. Model IDs are raw hosted ids (the editor namespaces them per entry group), so saved model selections must be rechosen once after upgrading. Forget/restore and entry-selection commands and settings, and the observation journal, were removed; management commands and inline suggestions use the most recently provisioned entry key.
