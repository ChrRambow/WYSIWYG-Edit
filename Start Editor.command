#!/bin/bash
# Double-click this file on a Mac to start WYSIWYG Edit.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1 || ! python3 -c "import sys" >/dev/null 2>&1; then
  osascript -e 'display alert "Python 3 is missing" message "WYSIWYG Edit needs Python 3. In Terminal, run: xcode-select --install"'
  exit 1
fi
python3 server.py "$@"
