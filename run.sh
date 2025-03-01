#!/bin/bash

# Find the best browser available
if command -v google-chrome &> /dev/null; then
    BROWSER="google-chrome"
elif command -v firefox &> /dev/null; then
    BROWSER="firefox"
elif command -v chromium &> /dev/null; then
    BROWSER="chromium"
elif command -v brave-browser &> /dev/null; then
    BROWSER="brave-browser"
elif command -v edge &> /dev/null; then
    BROWSER="edge"
elif command -v safari &> /dev/null; then
    BROWSER="safari"
else
    echo "No suitable browser found. Please open index.html manually."
    exit 1
fi

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Construct the full path to index.html
INDEX_PATH="file://$DIR/index.html"

# Open the browser with the index.html file
echo "Opening GitHub Browsealizer in $BROWSER..."
$BROWSER "$INDEX_PATH" &> /dev/null &

echo "GitHub Browsealizer launched successfully!"