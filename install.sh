#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing exceder..."

# 1. Link justfile
mkdir -p ~/.config/just
ln -sf "$SCRIPT_DIR/cli/justfile" ~/.config/just/justfile
echo "✓ Linked justfile to ~/.config/just/justfile"

# 2. Add alias to shell config
SHELL_RC=""
if [ -f ~/.zshrc ]; then
    SHELL_RC=~/.zshrc
elif [ -f ~/.bashrc ]; then
    SHELL_RC=~/.bashrc
fi

if [ -n "$SHELL_RC" ]; then
    # Check if alias already exists
    if ! grep -q 'alias xc=' "$SHELL_RC"; then
        echo "" >> "$SHELL_RC"
        echo "# Exceder - developer workflow toolkit" >> "$SHELL_RC"
        echo 'alias xc="just --justfile ~/.config/just/justfile --working-directory ."' >> "$SHELL_RC"
        echo "✓ Added 'xc' alias to $SHELL_RC"
    else
        echo "○ 'xc' alias already exists in $SHELL_RC"
    fi
fi

# 3. Create slots registry directory
mkdir -p ~/.config/slots
echo "✓ Created ~/.config/slots/"

echo ""
echo "════════════════════════════════════════"
echo "  Exceder installed!"
echo ""
echo "  Restart your shell or run:"
echo "    source $SHELL_RC"
echo ""
echo "  Then try:"
echo "    xc slot list"
echo "════════════════════════════════════════"
