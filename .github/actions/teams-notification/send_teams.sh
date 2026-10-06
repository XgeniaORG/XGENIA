#!/bin/bash
set -euo pipefail

TITLE="${MSG_TITLE:-}"
TEXT="${MSG_TEXT:-}"
URL="${WORKFLOW_URL:-}"
WEBHOOK="${WEBHOOK_URL:-}"
STATUS="${STATUS:-}"

if [ -z "$WEBHOOK" ]; then
  echo "No webhook URL configured, skipping Teams notification." >&2
  exit 0
fi

# Colour the heading so a failed run reads as failed at a glance.
case "$STATUS" in
  success) COLOR="good" ;;
  failure | cancelled) COLOR="attention" ;;
  *) COLOR="default" ;;
esac

# jq builds the payload so newlines and quotes in the title or body get escaped
# instead of terminating the JSON string. A plain heredoc emitted invalid JSON
# for any multi-line message, which the webhook accepts and then drops.
jq -n \
  --arg title "$TITLE" \
  --arg text "$TEXT" \
  --arg url "$URL" \
  --arg color "$COLOR" \
  '{
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: null,
      content: {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.2",
        body: ([
          {
            type: "TextBlock",
            text: $title,
            size: "Medium",
            weight: "Bolder",
            color: $color,
            wrap: true
          },
          {
            type: "TextBlock",
            text: $text,
            wrap: true
          }
        ] + (if $url == "" then [] else [
          {
            type: "ActionSet",
            actions: [{ type: "Action.OpenUrl", title: "View Workflow", url: $url }]
          }
        ] end))
      }
    }]
  }' > card.json

# --fail so a rejected card fails the step; without it a 4xx looked like a
# clean run and the message just never arrived.
curl -sS --fail -X POST \
  -H "Content-Type: application/json" \
  --data @card.json \
  "$WEBHOOK"
